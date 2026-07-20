const express = require("express");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 9090;

app.get("/", (_req, res) => {
	res.send("Servidor WebSocket Godot online");
});

const server = app.listen(PORT, () => {
	console.log("Servidor iniciado na porta: " + PORT);
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();
const MAX_PLAYERS_PER_ROOM = 5;

const ROOM_TICK_MS = 50;
const ZORD_DURATION_MS = 30000;
const MEGAZORD_DURATION_MS = 60000;
const MEGAZORD_DASH_SPEED = 1200;
const MEGAZORD_DASH_TIME = 180;
const MEGAZORD_DASH_COOLDOWN = 250;
const MEGAZORD_ATTACK_COOLDOWN = 800;
const MEGAZORD_ATTACK_TIME = 300;

function now() {
	return Date.now();
}

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

function send(socket, cmd, content = {}) {
	if (!socket || socket.readyState !== WebSocket.OPEN) return;
	socket.send(JSON.stringify({ cmd, content }));
}

function broadcastRoom(room, cmd, content = {}, exceptUuid = "") {
	if (!room || !room.players) return;

	for (const clientUuid in room.players) {
		if (exceptUuid && clientUuid === exceptUuid) continue;

		const client = room.players[clientUuid];
		if (client && client.readyState === WebSocket.OPEN) {
			send(client, cmd, content);
		}
	}
}

function getRoomPlayerSockets(room) {
	if (!room || !room.players) return [];
	return Object.values(room.players);
}

function getRoomPlayerCount(room) {
	return getRoomPlayerSockets(room).length;
}

function createRoom() {
	const roomCode = generateUniqueRoomCode();

	const room = {
		code: roomCode,
		players: {},
		creatorUuid: "",
		spawnX: 0,
		spawnY: 0,
		megazord: {
			active: false,
			x: 0,
			y: 0,
			dashDir: "",
			dashUntil: 0,
			dashCooldownUntil: 0,
			attackUntil: 0,
			attackCooldownUntil: 0,
			endsAt: 0,
			flipH: false,
			anim: "idle_down",
			attacking: false
		},
		tickHandle: null
	};

	rooms.set(roomCode, room);
	ensureRoomTick(room);

	return room;
}

function ensureRoomTick(room) {
	if (room.tickHandle) return;

	room.tickHandle = setInterval(() => {
		tickRoom(room);
	}, ROOM_TICK_MS);
}

function clearRoomTick(room) {
	if (room && room.tickHandle) {
		clearInterval(room.tickHandle);
		room.tickHandle = null;
	}
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
			attacking: false,
			mode: "normal",
			zord_expires_at: 0,
			megazord_input: {
				left: false,
				right: false,
				up: false,
				down: false,
				attack: false
			}
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

function allPlayersInZord(room) {
	const players = playerlist.getByRoom(room.code);
	if (players.length === 0) return false;
	return players.every((p) => p.mode === "zord");
}

function allPlayersAttack(room) {
	const players = playerlist.getByRoom(room.code);
	if (players.length === 0) return false;
	return players.every((p) => {
		return p.megazord_input && p.megazord_input.attack === true;
	});
}

function getConsensusDirection(room) {
	const players = playerlist.getByRoom(room.code);
	if (players.length === 0) return "";

	let consensus = "";

	for (const p of players) {
		const input = p.megazord_input || {};
		let dir = "";

		if (input.left) dir = "left";
		else if (input.right) dir = "right";
		else if (input.up) dir = "up";
		else if (input.down) dir = "down";

		if (dir === "") return "";
		if (consensus === "") consensus = dir;
		else if (consensus !== dir) return "";
	}

	return consensus;
}

function directionVector(dir) {
	switch (dir) {
		case "left":
			return { x: -1, y: 0 };
		case "right":
			return { x: 1, y: 0 };
		case "up":
			return { x: 0, y: -1 };
		case "down":
			return { x: 0, y: 1 };
		default:
			return { x: 0, y: 0 };
	}
}

function spawnMegazord(room) {
	if (!room || room.megazord.active) return;

	const players = playerlist.getByRoom(room.code);
	if (players.length === 0) return;

	room.megazord.active = true;
	room.megazord.x = room.spawnX;
	room.megazord.y = room.spawnY;
	room.megazord.dashDir = "";
	room.megazord.dashUntil = 0;
	room.megazord.dashCooldownUntil = 0;
	room.megazord.attackUntil = 0;
	room.megazord.attackCooldownUntil = 0;
	room.megazord.endsAt = now() + MEGAZORD_DURATION_MS;
	room.megazord.flipH = false;
	room.megazord.anim = "idle_down";
	room.megazord.attacking = false;

	for (const p of players) {
		p.x = room.spawnX;
		p.y = room.spawnY;
	}

	broadcastRoom(room, "teleport_players", {
		x: room.spawnX,
		y: room.spawnY
	});

	broadcastRoom(room, "spawn_megazord", {
		x: room.spawnX,
		y: room.spawnY,
		duration: MEGAZORD_DURATION_MS
	});

	broadcastRoom(room, "megazord_active", {
		active: true
	});

	broadcastRoom(room, "megazord_state", {
		x: room.megazord.x,
		y: room.megazord.y,
		anim: room.megazord.anim,
		flip_h: room.megazord.flipH,
		attacking: room.megazord.attacking
	});
}

function endMegazord(room) {
	if (!room || !room.megazord.active) return;

	const finalX = room.megazord.x;
	const finalY = room.megazord.y;

	room.megazord.active = false;
	room.megazord.dashDir = "";
	room.megazord.attacking = false;

	const players = playerlist.getByRoom(room.code);
	for (const p of players) {
		p.x = finalX;
		p.y = finalY;
		p.mode = "zord";
		p.zord_expires_at = now() + ZORD_DURATION_MS;
	}

	broadcastRoom(room, "despawn_megazord", {
		x: finalX,
		y: finalY
	});

	broadcastRoom(room, "teleport_players", {
		x: finalX,
		y: finalY
	});

	broadcastRoom(room, "megazord_active", {
		active: false
	});
}

function updateZordTimeouts(room) {
	if (room.megazord.active) return;

	const t = now();
	const players = playerlist.getByRoom(room.code);

	for (const p of players) {
		if (p.mode === "zord" && p.zord_expires_at && t >= p.zord_expires_at) {
			p.mode = "normal";
			p.zord_expires_at = 0;

			broadcastRoom(room, "player_mode", {
				uuid: p.uuid,
				mode: "normal",
				player_data: p
			});
		}
	}
}

function updateMegazord(room) {
	if (!room.megazord.active) return;

	const t = now();

	if (t >= room.megazord.endsAt) {
		endMegazord(room);
		return;
	}

	const dir = getConsensusDirection(room);

	if (dir && t >= room.megazord.dashCooldownUntil) {
		room.megazord.dashDir = dir;
		room.megazord.dashUntil = t + MEGAZORD_DASH_TIME;
		room.megazord.dashCooldownUntil = t + MEGAZORD_DASH_COOLDOWN;
	}

	if (room.megazord.dashDir && t < room.megazord.dashUntil) {
		const v = directionVector(room.megazord.dashDir);
		const dt = ROOM_TICK_MS / 1000;
		room.megazord.x += v.x * MEGAZORD_DASH_SPEED * dt;
		room.megazord.y += v.y * MEGAZORD_DASH_SPEED * dt;

		if (v.x !== 0) {
			room.megazord.flipH = v.x > 0;
			room.megazord.anim = "walk_left";
		} else if (v.y !== 0) {
			room.megazord.anim = v.y > 0 ? "walk_down" : "walk_up";
		}
	} else {
		room.megazord.dashDir = "";
		room.megazord.anim = "idle_down";
	}

	if (allPlayersAttack(room) && t >= room.megazord.attackCooldownUntil) {
		room.megazord.attacking = true;
		room.megazord.attackUntil = t + MEGAZORD_ATTACK_TIME;
		room.megazord.attackCooldownUntil = t + MEGAZORD_ATTACK_COOLDOWN;

		broadcastRoom(room, "megazord_attack", {
			attack: true
		});
	}

	if (room.megazord.attacking && t >= room.megazord.attackUntil) {
		room.megazord.attacking = false;

		broadcastRoom(room, "megazord_attack", {
			attack: false
		});
	}

	broadcastRoom(room, "megazord_state", {
		x: room.megazord.x,
		y: room.megazord.y,
		anim: room.megazord.anim,
		flip_h: room.megazord.flipH,
		attacking: room.megazord.attacking
	});
}

function tickRoom(room) {
	updateZordTimeouts(room);

	if (!room.megazord.active && allPlayersInZord(room)) {
		spawnMegazord(room);
	}

	updateMegazord(room);
}

function setRoomCreator(room, newCreatorUuid) {
	room.creatorUuid = newCreatorUuid || "";

	if (!room.creatorUuid) {
		room.spawnX = 0;
		room.spawnY = 0;
		return;
	}

	const creatorPlayer = playerlist.get(room.creatorUuid);
	if (creatorPlayer) {
		room.spawnX = creatorPlayer.x;
		room.spawnY = creatorPlayer.y;
	}
}

function removePlayerFromRoom(socket) {
	const uuid = socket.uuid;
	const roomCode = socket.roomId;
	if (!uuid || !roomCode) return;

	const room = rooms.get(roomCode);
	if (!room) return;

	delete room.players[uuid];
	playerlist.remove(uuid);

	broadcastRoom(room, "player_disconnected", {
		uuid: uuid
	});

	broadcastRoom(room, "remove_player", {
		uuid: uuid
	});

	if (room.creatorUuid === uuid) {
		const remaining = playerlist.getByRoom(roomCode);
		if (remaining.length > 0) {
			setRoomCreator(room, remaining[0].uuid);
		} else {
			room.creatorUuid = "";
			room.spawnX = 0;
			room.spawnY = 0;
		}
	}

	if (Object.keys(room.players).length === 0) {
		clearRoomTick(room);
		rooms.delete(roomCode);
		console.log("Sala removida:", roomCode);
	}

	socket.roomId = "";
}

function buildRoomPlayersPayload(room, localUuid = "") {
	return playerlist.getByRoom(room.code).map((p) => {
		return {
			...p,
			is_local: p.uuid === localUuid
		};
	});
}

function sendRoomStateToJoiner(socket, room, localUuid) {
	const players = buildRoomPlayersPayload(room, localUuid);

	send(socket, "room_players", {
		players: players
	});

	send(socket, "spawn_network_players", {
		players: players.filter((p) => p.uuid !== localUuid)
	});

	send(socket, "spawn_local_player", {
		player: players.find((p) => p.uuid === localUuid) || {}
	});

	if (room.megazord.active) {
		send(socket, "megazord_active", {
			active: true
		});

		send(socket, "spawn_megazord", {
			x: room.megazord.x,
			y: room.megazord.y,
			duration: MEGAZORD_DURATION_MS
		});

		send(socket, "megazord_state", {
			x: room.megazord.x,
			y: room.megazord.y,
			anim: room.megazord.anim,
			flip_h: room.megazord.flipH,
			attacking: room.megazord.attacking
		});

		send(socket, "teleport_players", {
			x: room.megazord.x,
			y: room.megazord.y
		});
	}
}

wss.on("connection", (socket) => {
	const uuid = uuidv4();
	socket.uuid = uuid;
	socket.roomId = "";

	console.log("Cliente conectado:", uuid);

	send(socket, "joined_server", {
		uuid: uuid
	});

	socket.on("message", (message) => {
		let data;
		try {
			data = JSON.parse(message.toString());
		} catch (err) {
			console.error("Erro ao parsear mensagem:", err);
			send(socket, "error", {
				type: "bad_json",
				msg: "JSON inválido."
			});
			return;
		}

		switch (data.cmd) {
			case "create_room": {
				const room = createRoom();
				socket.roomId = room.code;

				room.players[uuid] = socket;

				const nickname = normalizeNick(data.content?.nickname) || "Player";
				const player_index = normalizeColorIndex(data.content?.player_index);

				const newPlayer = playerlist.add(uuid, room.code, nickname, player_index);
				setRoomCreator(room, uuid);
				room.spawnX = newPlayer.x;
				room.spawnY = newPlayer.y;

				console.log("Sala criada:", room.code);

				send(socket, "room_created", {
					code: room.code
				});

				sendRoomStateToJoiner(socket, room, uuid);

				send(socket, "start_game", {});

				break;
			}

			case "join_room": {
				const roomCode = String(data.content?.code || "").toUpperCase();
				const room = rooms.get(roomCode);

				if (!room) {
					send(socket, "error", {
						type: "room_not_found",
						msg: "Sala não encontrada."
					});
					return;
				}

				if (getRoomPlayerCount(room) >= MAX_PLAYERS_PER_ROOM) {
					send(socket, "error", {
						type: "room_full",
						msg: "Sala cheia. Limite de 5 jogadores."
					});
					return;
				}

				const nickname = normalizeNick(data.content?.nickname) || "Player";
				const player_index = normalizeColorIndex(data.content?.player_index);

				if (roomHasNickname(roomCode, nickname)) {
					send(socket, "error", {
						type: "nickname_taken",
						msg: "Nick já escolhido."
					});
					return;
				}

				if (roomHasColor(roomCode, player_index)) {
					send(socket, "error", {
						type: "color_taken",
						msg: "Cor já selecionada."
					});
					return;
				}

				socket.roomId = roomCode;
				room.players[uuid] = socket;

				const newPlayer = playerlist.add(uuid, roomCode, nickname, player_index);

				console.log("Jogador entrou:", uuid, "na sala", roomCode);

				send(socket, "room_joined", {
					code: roomCode
				});

				sendRoomStateToJoiner(socket, room, uuid);

				broadcastRoom(room, "spawn_new_player", {
					player: {
						...newPlayer,
						is_local: false
					}
				}, uuid);

				broadcastRoom(room, "spawn_player", {
					player: {
						...newPlayer,
						is_local: false
					}
				}, uuid);

				broadcastRoom(room, "start_game", {});

				break;
			}

			case "leave_room": {
				removePlayerFromRoom(socket);
				break;
			}

			case "request_zord": {
				if (!socket.roomId) break;

				const room = rooms.get(socket.roomId);
				if (!room) break;

				const player = playerlist.get(uuid);
				if (!player) break;

				if (player.mode === "zord") {
					break;
				}

				player.mode = "zord";
				player.zord_expires_at = now() + ZORD_DURATION_MS;

				broadcastRoom(room, "player_mode", {
					uuid: player.uuid,
					mode: "zord",
					player_data: {
						...player,
						is_local: false
					}
				});

				if (!room.megazord.active && allPlayersInZord(room)) {
					room.spawnX = room.spawnX || player.x;
					room.spawnY = room.spawnY || player.y;
					spawnMegazord(room);
				}

				break;
			}

			case "player_state": {
				if (!socket.roomId) break;

				const room = rooms.get(socket.roomId);
				if (!room) break;

				const state = {
					x: Number(data.content?.x) || 0,
					y: Number(data.content?.y) || 0,
					anim: String(data.content?.anim || "idle_down"),
					flip_h: !!data.content?.flip_h,
					shield: !!data.content?.shield,
					attacking: !!data.content?.attacking,
					player_index: Number(data.content?.player_index) || 0,
					nickname: normalizeNick(data.content?.nickname) || "Player"
				};

				const player = playerlist.get(uuid);
				if (player) {
					playerlist.update(uuid, state);

					if (player.uuid === room.creatorUuid) {
						room.spawnX = state.x;
						room.spawnY = state.y;
					}

					if (data.content?.megazord_input) {
						player.megazord_input = {
							left: !!data.content.megazord_input.left,
							right: !!data.content.megazord_input.right,
							up: !!data.content.megazord_input.up,
							down: !!data.content.megazord_input.down,
							attack: !!data.content.megazord_input.attack
						};
					}

					if (typeof data.content?.mode === "string") {
						if (data.content.mode === "normal" || data.content.mode === "zord") {
							player.mode = data.content.mode;
						}
					}
				}

				broadcastRoom(room, "player_state", {
					uuid: uuid,
					...state
				}, uuid);

				broadcastRoom(room, "update_position", {
					uuid: uuid,
					x: state.x,
					y: state.y
				}, uuid);

				break;
			}

			case "position": {
				if (!socket.roomId) break;

				const room = rooms.get(socket.roomId);
				if (!room) break;

				const x = Number(data.content?.x) || 0;
				const y = Number(data.content?.y) || 0;

				playerlist.update(uuid, { x, y });

				const player = playerlist.get(uuid);
				if (player && player.uuid === room.creatorUuid) {
					room.spawnX = x;
					room.spawnY = y;
				}

				broadcastRoom(room, "update_position", {
					uuid: uuid,
					x: x,
					y: y
				}, uuid);

				break;
			}

			case "megazord_input": {
				if (!socket.roomId) break;

				const room = rooms.get(socket.roomId);
				if (!room) break;

				const player = playerlist.get(uuid);
				if (!player) break;

				player.megazord_input = {
					left: !!data.content?.left,
					right: !!data.content?.right,
					up: !!data.content?.up,
					down: !!data.content?.down,
					attack: !!data.content?.attack
				};

				break;
			}

			case "chat": {
				if (!socket.roomId) break;

				const room = rooms.get(socket.roomId);
				if (!room) break;

				broadcastRoom(room, "chat", {
					uuid: uuid,
					msg: String(data.content?.msg || "")
				});

				break;
			}

			default:
				console.log("Comando desconhecido:", data.cmd);
				break;
		}
	});

	socket.on("close", () => {
		console.log("Cliente desconectado:", uuid);
		removePlayerFromRoom(socket);
	});
});
