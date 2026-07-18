const express = require("express");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 9090;

const server = app.listen(PORT, () => {
	console.log("Servidor iniciado na porta: " + PORT);
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();
const MAX_PLAYERS_PER_ROOM = 5;

function generateRoomCode(length = 5) {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let result = "";
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

function generateUniqueRoomCode() {
	let code = generateRoomCode();
	while (rooms.has(code)) {
		code = generateRoomCode();
	}
	return code;
}

const playerlist = {
	players: [],

	get(uuid) {
		return this.players.find((player) => player.uuid === uuid);
	},

	getByRoom(roomCode) {
		return this.players.filter((player) => player.room === roomCode);
	},

	add(uuid, roomCode) {
		const playersInRoom = this.getByRoom(roomCode);
		const isFirstPlayer = playersInRoom.length === 0;
		const playerIndex = playersInRoom.length + 1;

		const player = {
			uuid: uuid,
			room: roomCode,
			player_index: playerIndex,
			x: isFirstPlayer ? 550 : 700,
			y: 300,
			anim: "idle_down",
			flip_h: false,
			shield: false,
			attacking: false
		};

		this.players.push(player);
		return player;
	},

	update(uuid, patch) {
		const player = this.get(uuid);
		if (player) {
			Object.assign(player, patch);
		}
	},

	remove(uuid) {
		this.players = this.players.filter((player) => player.uuid !== uuid);
	}
};

wss.on("connection", (socket) => {
	const uuid = uuidv4();
	socket.uuid = uuid;

	console.log("Cliente conectado:", uuid);

	socket.send(JSON.stringify({
		cmd: "joined_server",
		content: { uuid: uuid }
	}));

	socket.on("message", (message) => {
		let data;
		try {
			data = JSON.parse(message.toString());
		} catch (err) {
			console.error("Erro ao parsear mensagem:", err);
			return;
		}

		switch (data.cmd) {
			case "create_room": {
				const roomCode = generateUniqueRoomCode();
				socket.roomId = roomCode;

				rooms.set(roomCode, {
					players: {}
				});

				rooms.get(roomCode).players[uuid] = socket;

				const newPlayer = playerlist.add(uuid, roomCode);

				console.log("Sala criada:", roomCode);

				socket.send(JSON.stringify({
					cmd: "room_created",
					content: { code: roomCode }
				}));

				socket.send(JSON.stringify({
					cmd: "spawn_local_player",
					content: { player: newPlayer }
				}));

				socket.send(JSON.stringify({
					cmd: "start_game",
					content: {}
				}));

				break;
			}

			case "join_room": {
				const roomCode = String(data.content.code || "").toUpperCase();
				const roomToJoin = rooms.get(roomCode);

				if (!roomToJoin) {
					socket.send(JSON.stringify({
						cmd: "error",
						content: { msg: "Sala não encontrada." }
					}));
					return;
				}

				if (Object.keys(roomToJoin.players).length >= MAX_PLAYERS_PER_ROOM) {
					socket.send(JSON.stringify({
						cmd: "error",
						content: { msg: "Sala cheia. Limite de 5 jogadores." }
					}));
					return;
				}

				socket.roomId = roomCode;
				roomToJoin.players[uuid] = socket;

				const newPlayer = playerlist.add(uuid, roomCode);

				console.log("Jogador entrou:", uuid, "na sala", roomCode);

				socket.send(JSON.stringify({
					cmd: "room_joined",
					content: { code: roomCode }
				}));

				socket.send(JSON.stringify({
					cmd: "spawn_local_player",
					content: { player: newPlayer }
				}));

				const roomPlayers = playerlist
					.getByRoom(roomCode)
					.filter((p) => p.uuid !== uuid);

				socket.send(JSON.stringify({
					cmd: "spawn_network_players",
					content: { players: roomPlayers }
				}));

				for (const clientUuid in roomToJoin.players) {
					const client = roomToJoin.players[clientUuid];
					if (client !== socket && client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify({
							cmd: "spawn_new_player",
							content: { player: newPlayer }
						}));
					}
				}

				for (const clientUuid in roomToJoin.players) {
					const client = roomToJoin.players[clientUuid];
					if (client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify({
							cmd: "start_game",
							content: {}
						}));
					}
				}

				break;
			}

			case "player_state": {
				if (!socket.roomId) {
					break;
				}

				const room = rooms.get(socket.roomId);
				if (!room) {
					break;
				}

				const state = {
					x: Number(data.content.x) || 0,
					y: Number(data.content.y) || 0,
					anim: String(data.content.anim || "idle_down"),
					flip_h: !!data.content.flip_h,
					shield: !!data.content.shield,
					attacking: !!data.content.attacking,
					player_index: Number(data.content.player_index) || 1
				};

				playerlist.update(uuid, state);

				for (const clientUuid in room.players) {
					const client = room.players[clientUuid];
					if (client !== socket && client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify({
							cmd: "player_state",
							content: {
								uuid: uuid,
								...state
							}
						}));
					}
				}

				break;
			}

			case "position": {
				if (!socket.roomId) {
					break;
				}

				const room = rooms.get(socket.roomId);
				if (!room) {
					break;
				}

				const state = {
					x: Number(data.content.x) || 0,
					y: Number(data.content.y) || 0,
					anim: "idle_down",
					flip_h: false,
					shield: false,
					attacking: false,
					player_index: 1
				};

				playerlist.update(uuid, state);

				for (const clientUuid in room.players) {
					const client = room.players[clientUuid];
					if (client !== socket && client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify({
							cmd: "player_state",
							content: {
								uuid: uuid,
								...state
							}
						}));
					}
				}

				break;
			}

			case "chat": {
				if (!socket.roomId) {
					break;
				}

				const room = rooms.get(socket.roomId);
				if (!room) {
					break;
				}

				for (const clientUuid in room.players) {
					const client = room.players[clientUuid];
					if (client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify({
							cmd: "new_chat_message",
							content: {
								uuid: uuid,
								msg: data.content.msg
							}
						}));
					}
				}

				break;
			}

			default:
				console.log("Comando desconhecido:", data.cmd);
				break;
		}
	});

	socket.on("close", () => {
		console.log("Cliente desconectado:", uuid);

		playerlist.remove(uuid);

		const room = rooms.get(socket.roomId);
		if (room) {
			delete room.players[uuid];

			for (const clientUuid in room.players) {
				const client = room.players[clientUuid];
				if (client.readyState === WebSocket.OPEN) {
					client.send(JSON.stringify({
						cmd: "player_disconnected",
						content: { uuid: uuid }
					}));
				}
			}

			if (Object.keys(room.players).length === 0) {
				rooms.delete(socket.roomId);
				console.log("Sala removida:", socket.roomId);
			}
		}
	});
});
