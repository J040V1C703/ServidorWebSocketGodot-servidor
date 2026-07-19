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

function normalizeNick(nick) {
	return String(nick || "").trim();
}

function normalizeColorIndex(value) {
	const n = Number(value);
	if (Number.isNaN(n)) return 0;
	return Math.max(0, Math.min(31, Math.floor(n)));
}

const playerlist = {
	players: [],

	get(uuid) {
		return this.players.find((player) => player.uuid === uuid);
	},

	getByRoom(roomCode) {
		return this.players.filter((player) => player.room === roomCode);
	},

	add(uuid, roomCode, nickname, player_index) {
		const playersInRoom = this.getByRoom(roomCode);
		const isFirstPlayer = playersInRoom.length === 0;

		const player = {
			uuid: uuid,
			room: roomCode,
			player_index: normalizeColorIndex(player_index),
			nickname: normalizeNick(nickname) || "Player",
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

function roomHasNickname(roomCode, nickname, ignoreUuid = "") {
	const nick = normalizeNick(nickname).toLowerCase();
	if (nick === "") return false;

	return playerlist.getByRoom(roomCode).some((p) => {
		return p.uuid !== ignoreUuid && String(p.nickname || "").toLowerCase() === nick;
	});
}

function roomHasColor(roomCode, playerIndex, ignoreUuid = "") {
	const idx = normalizeColorIndex(playerIndex);

	return playerlist.getByRoom(roomCode).some((p) => {
		return p.uuid !== ignoreUuid && normalizeColorIndex(p.player_index) === idx;
	});
}

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

				const nickname = normalizeNick(data.content.nickname) || "Player";
				const player_index = normalizeColorIndex(data.content.player_index);

				const newPlayer = playerlist.add(uuid, roomCode, nickname, player_index);

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
						content: { type: "room_not_found", msg: "Sala não encontrada." }
					}));
					return;
				}

				const nickname = normalizeNick(data.content.nickname) || "Player";
				const player_index = normalizeColorIndex(data.content.player_index);

				if (Object.keys(roomToJoin.players).length >= MAX_PLAYERS_PER_ROOM) {
					socket.send(JSON.stringify({
						cmd: "error",
						content: { type: "room_full", msg: "Sala cheia. Limite de 5 jogadores." }
					}));
					return;
				}

				if (roomHasNickname(roomCode, nickname)) {
					socket.send(JSON.stringify({
						cmd: "error",
						content: { type: "nickname_taken", msg: "Nick já escolhido." }
					}));
					return;
				}

				if (roomHasColor(roomCode, player_index)) {
					socket.send(JSON.stringify({
						cmd: "error",
						content: { type: "color_taken", msg: "Cor já selecionada." }
					}));
					return;
				}

				socket.roomId = roomCode;
				roomToJoin.players[uuid] = socket;

				const newPlayer = playerlist.add(uuid, roomCode, nickname, player_index);

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
				if (!socket.roomId) break;

				const room = rooms.get(socket.roomId);
				if (!room) break;

				const state = {
					x: Number(data.content.x) || 0,
					y: Number(data.content.y) || 0,
					anim: String(data.content.anim || "idle_down"),
					flip_h: !!data.content.flip_h,
					shield: !!data.content.shield,
					attacking: !!data.content.attacking,
					player_index: Number(data.content.player_index) || 0,
					nickname: normalizeNick(data.content.nickname) || "Player"
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
				if (!socket.roomId) break;

				const room = rooms.get(socket.roomId);
				if (!room) break;

				playerlist.update(uuid, {
					x: Number(data.content.x) || 0,
					y: Number(data.content.y) || 0
				});

				for (const clientUuid in room.players) {
					const client = room.players[clientUuid];
					if (client !== socket && client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify({
							cmd: "update_position",
							content: {
								uuid: uuid,
								x: Number(data.content.x) || 0,
								y: Number(data.content.y) || 0
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
