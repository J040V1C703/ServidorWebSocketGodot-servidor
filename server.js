22// ========================================
// SERVIDOR WEBSOCKET GODOT 4
// PARTE 1/4
// ========================================

const express = require("express");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const app = express();

const PORT = process.env.PORT || 9090;


app.get("/", (req, res) => {
	res.send("Servidor WebSocket online");
});


const server = app.listen(PORT, () => {
	console.log(
		"Servidor iniciado na porta:",
		PORT
	);
});


const wss = new WebSocket.Server({
	server
});


// ========================================
// CONFIGURAÇÕES
// ========================================

const MAX_PLAYERS = 5;

const ZORD_DURATION = 30000;
const ZORD_COOLDOWN = 60000;

const MEGAZORD_DURATION = 60000;

const TICK_RATE = 50;


// ========================================
// SALAS
// ========================================

const rooms = new Map();


// ========================================
// FUNÇÕES DE ENVIO
// ========================================

function send(socket, type, data = {}) {

	if (!socket)
		return;


	if(socket.readyState !== WebSocket.OPEN)
		return;


	socket.send(JSON.stringify({

		type:type,

		data:data

	}));

}



function broadcast(room, type, data = {}, except = "") {


	if(!room)
		return;


	for(const id in room.players){


		if(id === except)
			continue;


		const client = room.players[id];


		send(
			client,
			type,
			data
		);

	}

}



function sendMessage(room, text){

	broadcast(
		room,
		"chat",
		{
			message:text,
			system:true
		}
	);

}



// ========================================
// CÓDIGOS DE SALA
// ========================================

function createRoomCode(){


	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";


	let result = "";


	for(let i = 0; i < 5; i++){

		result += chars[
			Math.floor(
				Math.random()*chars.length
			)
		];

	}


	return result;

}



function uniqueRoomCode(){

	let code;


	do{

		code = createRoomCode();

	}
	while(rooms.has(code));


	return code;

}



// ========================================
// NORMALIZAÇÃO
// ========================================

function normalizeName(value){

	return String(value || "")
		.trim();

}



function normalizeIndex(value){

	let number =
		Number(value);


	if(Number.isNaN(number))
		number = 0;


	return Math.max(
		0,
		Math.min(
			31,
			Math.floor(number)
		)
	);

}



// ========================================
// PLAYER DATABASE
// ========================================

const players = {


	list: [],



	get(uuid){

		return this.list.find(
			p => p.uuid === uuid
		);

	},



	getRoom(room){

		return this.list.filter(
			p => p.room === room
		);

	},



	add(uuid, room, data){


		const player = {


			uuid:uuid,

			room:room,


			nickname:
				normalizeName(data.nickname)
				|| "Player",



			player_index:
				normalizeIndex(
					data.player_index
				),



			x:550,

			y:300,



			anim:"idle_down",

			flip_h:false,



			shield:false,

			attacking:false,



			mode:"player",



			zord_time:0,

			zord_cooldown:0,



			megazord_input:{


				left:false,

				right:false,

				up:false,

				down:false,

				attack:false

			}


		};



		this.list.push(player);


		return player;

	},



	update(uuid,data){


		const player =
			this.get(uuid);



		if(player){

			Object.assign(
				player,
				data
			);

		}


	},



	remove(uuid){


		this.list =
			this.list.filter(
				p => p.uuid !== uuid
			);


	}


};



// ========================================
// CRIAÇÃO DE SALA
// ========================================

function createRoom(){


	const code =
		uniqueRoomCode();



	const room = {


		code:code,


		players:{},



		creator:"",



		megazord:{


			active:false,


			x:0,

			y:0,


			anim:"idle_down",

			flip:false,


			attacking:false,


			endTime:0


		}



	};



	rooms.set(
		code,
		room
	);



	return room;

}
// ========================================
// CONEXÃO DOS CLIENTES
// ========================================

wss.on("connection", (socket)=>{


	const uuid = uuidv4();


	socket.uuid = uuid;


	socket.roomId = "";



	console.log(
		"Cliente conectado:",
		uuid
	);



	send(
		socket,
		"connected",
		{
			uuid:uuid
		}
	);





// ========================================
// RECEBIMENTO DE MENSAGENS
// ========================================

	socket.on("message",(raw)=>{


		let msg;


		try{


			msg =
				JSON.parse(
					raw.toString()
				);


		}
		catch(e){


			console.log(
				"JSON inválido"
			);


			return;

		}



		const type =
			String(
				msg.type || ""
			);



		const data =
			msg.data || {};





		switch(type){



// ========================================
// CRIAR SALA
// ========================================

		case "create_room":{


			const room =
				createRoom();



			socket.roomId =
				room.code;



			room.players[uuid] =
				socket;



			room.creator =
				uuid;




			const player =
				players.add(
					uuid,
					room.code,
					data
				);



			send(
				socket,
				"room_created",
				{
					code:room.code
				}
			);




			send(
				socket,
				"spawn_player",
				{
					player:player,
					local:true
				}
			);



			sendMessage(
				room,
				player.nickname+
				" entrou no jogo"
			);



			send(
				socket,
				"start_game"
			);



			console.log(
				"Sala criada:",
				room.code
			);



			break;

		}




// ========================================
// ENTRAR NA SALA
// ========================================

		case "join_room":{


			const code =
				String(
					data.code || ""
				)
				.toUpperCase();



			const room =
				rooms.get(code);



			if(!room){


				send(
					socket,
					"server_error",
					{
						msg:"Sala não encontrada"
					}
				);


				break;

			}





			const count =
				Object.keys(
					room.players
				).length;




			if(count >= MAX_PLAYERS){


				send(
					socket,
					"server_error",
					{
						msg:"Sala cheia"
					}
				);


				break;

			}




			socket.roomId =
				code;



			room.players[uuid] =
				socket;




			const player =
				players.add(
					uuid,
					code,
					data
				);




			send(
				socket,
				"room_joined",
				{
					code:code
				}
			);





			// cria o jogador local

			send(
				socket,
				"spawn_player",
				{
					player:player,
					local:true
				}
			);





			// envia jogadores existentes

			const others =
				players
				.getRoom(code)
				.filter(
					p=>p.uuid !== uuid
				);




			send(
				socket,
				"room_players",
				{
					players:others
				}
			);





			// avisa os outros

			broadcast(
				room,
				"spawn_player",
				{
					player:player,
					local:false
				},
				uuid
			);





			sendMessage(
				room,
				player.nickname+
				" entrou no jogo"
			);



			send(
				socket,
				"start_game"
			);



			break;

		}
				// ========================================
// ESTADO DO JOGADOR
// ========================================

		case "player_state": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			if(!room)
				break;




			const player =
				players.get(uuid);



			if(!player)
				break;




			const state = {


				x:
					Number(data.x) || player.x,


				y:
					Number(data.y) || player.y,



				anim:
					String(
						data.anim ||
						player.anim
					),



				flip_h:
					!!data.flip_h,



				shield:
					!!data.shield,



				attacking:
					!!data.attacking,



				player_index:
					normalizeIndex(
						data.player_index
					)

			};





			const oldShield =
				player.shield;



			players.update(
				uuid,
				state
			);




			if(!oldShield && state.shield){


				sendMessage(
					room,
					player.nickname+
					" pegou o escudo"
				);

			}




			broadcast(
				room,
				"player_state",
				{
					uuid:uuid,
					...state
				},
				uuid
			);



			break;

		}





// ========================================
// POSIÇÃO SIMPLES
// ========================================

		case "position": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			if(!room)
				break;



			players.update(
				uuid,
				{
					x:Number(data.x)||0,
					y:Number(data.y)||0
				}
			);




			broadcast(
				room,
				"update_position",
				{
					uuid:uuid,
					x:Number(data.x)||0,
					y:Number(data.y)||0
				},
				uuid
			);



			break;

		}





// ========================================
// CHAMAR ZORD
// ========================================

		case "spawn_zord": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			const player =
				players.get(uuid);



			if(!room || !player)
				break;




			player.mode =
				"zord";



			player.zord_time =
				Date.now()+
				ZORD_DURATION;



			sendMessage(
				room,
				player.nickname+
				" chamou o Zord"
			);



			broadcast(
				room,
				"spawn_zord",
				{
					uuid:uuid,
					x:player.x,
					y:player.y,
					player_index:
						player.player_index,
					nickname:
						player.nickname
				}
			);



			break;

		}





// ========================================
// ESTADO DO ZORD
// ========================================

		case "zord_state": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			if(!room)
				break;




			broadcast(
				room,
				"zord_state",
				{
					uuid:uuid,
					x:data.x,
					y:data.y,
					anim:data.anim,
					flip_h:data.flip_h,
					attack:data.attack
				},
				uuid
			);



			break;

		}





// ========================================
// SAIR DO ZORD
// ========================================

		case "despawn_zord": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			const player =
				players.get(uuid);



			if(player)
				player.mode="player";




			broadcast(
				room,
				"despawn_zord",
				{
					uuid:uuid
				}
			);



			break;

		}
		// ========================================
// INPUT DO MEGAZORD
// ========================================

		case "megazord_input": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			if(!room)
				break;




			const player =
				players.get(uuid);



			if(!player)
				break;




			player.megazord_input = {


				left:
					!!data.left,


				right:
					!!data.right,


				up:
					!!data.up,


				down:
					!!data.down,


				attack:
					!!data.attack

			};




			broadcast(
				room,
				"megazord_input",
				{
					uuid:uuid,
					input:
						player.megazord_input
				},
				uuid
			);



			break;

		}





// ========================================
// ESTADO DO MEGAZORD
// ========================================

		case "megazord_state": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			if(!room)
				break;




			room.megazord = {


				active:true,


				x:
					Number(data.x)||0,


				y:
					Number(data.y)||0,


				anim:
					String(
						data.anim||
						"idle"
					),


				flip_h:
					!!data.flip_h,


				attacking:
					!!data.attacking

			};




			broadcast(
				room,
				"megazord_state",
				{
					...room.megazord
				},
				uuid
			);



			break;

		}





// ========================================
// ATIVA MEGAZORD
// ========================================

		case "spawn_megazord": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			if(!room)
				break;



			room.megazord.active =
				true;



			room.megazord.endTime =
				Date.now()+
				MEGAZORD_DURATION;




			broadcast(
				room,
				"spawn_megazord",
				{
					players:
						players.getRoom(
							socket.roomId
						)
				}
			);



			break;

		}





// ========================================
// DESTRUIR MEGAZORD
// ========================================

		case "despawn_megazord": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			if(room){

				room.megazord.active =
					false;


				broadcast(
					room,
					"despawn_megazord",
					{}
				);

			}



			break;

		}





// ========================================
// ATAQUE DO MEGAZORD
// ========================================

		case "megazord_attack": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			broadcast(
				room,
				"megazord_attack",
				{
					uuid:uuid
				}
			);



			break;

		}





// ========================================
// CHAT
// ========================================

		case "chat": {


			if(!socket.roomId)
				break;



			const room =
				rooms.get(
					socket.roomId
				);



			const player =
				players.get(uuid);



			if(!room || !player)
				break;




			broadcast(
				room,
				"chat",
				{
					message:
						player.nickname+
						": "+
						String(
							data.message||
							""
						),
					system:false
				}
			);



			break;

		}





// ========================================
// DESCONHECIDO
// ========================================
const express = require("express");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 9090;

app.get("/", (_req, res) => {
	res.send("Servidor WebSocket online");
});

const server = app.listen(PORT, () => {
	console.log("Servidor iniciado na porta:", PORT);
});

const wss = new WebSocket.Server({ server });

const MAX_PLAYERS_PER_ROOM = 5;
const ZORD_DURATION_MS = 30000;
const ZORD_COOLDOWN_MS = 60000;
const MEGAZORD_DURATION_MS = 60000;
const TICK_MS = 50;

const rooms = new Map();

function now() {
	return Date.now();
}

function send(socket, type, data = {}) {
	if (!socket || socket.readyState !== WebSocket.OPEN) return;
	socket.send(JSON.stringify({ type, data }));
}

function broadcastRoom(room, type, data = {}, exceptUuid = "") {
	if (!room) return;

	for (const clientUuid in room.players) {
		if (exceptUuid && clientUuid === exceptUuid) continue;
		const client = room.players[clientUuid];
		if (client && client.readyState === WebSocket.OPEN) {
			send(client, type, data);
		}
	}
}

function systemMessage(room, text) {
	broadcastRoom(room, "system_message", { message: text, system: true });
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

const playerlist = {
	players: [],

	get(uuid) {
		return this.players.find((p) => p.uuid === uuid);
	},

	getByRoom(roomCode) {
		return this.players.filter((p) => p.room === roomCode);
	},

	add(uuid, roomCode, nickname, player_index) {
		const playersInRoom = this.getByRoom(roomCode);
		const isFirstPlayer = playersInRoom.length === 0;

		const player = {
			uuid,
			room: roomCode,
			nickname: normalizeNick(nickname) || "Player",
			player_index: normalizeColorIndex(player_index),
			x: isFirstPlayer ? 550 : 700,
			y: 300,
			anim: "idle_down",
			flip_h: false,
			shield: false,
			attacking: false,
			mode: "normal",
			zord_expires_at: 0,
			zord_cooldown_until: 0,
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
		if (player) Object.assign(player, patch);
	},

	remove(uuid) {
		this.players = this.players.filter((p) => p.uuid !== uuid);
	}
};

function getRoomPlayerCount(room) {
	return Object.keys(room.players || {}).length;
}

function buildPlayerPayload(player, isLocal = false) {
	return {
		...player,
		is_local: isLocal
	};
}

function allPlayersInZord(room) {
	const players = playerlist.getByRoom(room.code);
	if (players.length < 2) return false;
	return players.every((p) => p.mode === "zord");
}

function allPlayersAttack(room) {
	const players = playerlist.getByRoom(room.code);
	if (players.length === 0) return false;
	return players.every((p) => p.megazord_input && p.megazord_input.attack === true);
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
		case "left": return { x: -1, y: 0 };
		case "right": return { x: 1, y: 0 };
		case "up": return { x: 0, y: -1 };
		case "down": return { x: 0, y: 1 };
		default: return { x: 0, y: 0 };
	}
}

function createRoom() {
	const code = generateUniqueRoomCode();

	const room = {
		code,
		players: {},
		creatorUuid: "",
		spawnX: 0,
		spawnY: 0,
		megazord: {
			active: false,
			x: 0,
			y: 0,
			anim: "idle_down",
			flipH: false,
			attacking: false,
			endTime: 0,
			dashDir: "",
			dashUntil: 0,
			dashCooldownUntil: 0,
			attackUntil: 0,
			attackCooldownUntil: 0
		},
		tickHandle: null
	};

	rooms.set(code, room);
	room.tickHandle = setInterval(() => tickRoom(room), TICK_MS);
	return room;
}

function setRoomCreator(room, uuid) {
	room.creatorUuid = uuid || "";
	const creator = playerlist.get(room.creatorUuid);
	if (creator) {
		room.spawnX = creator.x;
		room.spawnY = creator.y;
	}
}

function sendRoomSnapshotToJoiner(socket, room, localUuid) {
	const others = playerlist.getByRoom(room.code).filter((p) => p.uuid !== localUuid);

	send(socket, "room_players", {
		players: others.map((p) => buildPlayerPayload(p, false))
	});

	if (room.megazord.active) {
		send(socket, "megazord_active", { active: true });
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

function spawnMegazord(room) {
	if (!room || room.megazord.active) return;

	const players = playerlist.getByRoom(room.code);
	if (players.length < 2) return;

	room.megazord.active = true;
	room.megazord.x = room.spawnX;
	room.megazord.y = room.spawnY;
	room.megazord.anim = "idle_down";
	room.megazord.flipH = false;
	room.megazord.attacking = false;
	room.megazord.endTime = now() + MEGAZORD_DURATION_MS;
	room.megazord.dashDir = "";
	room.megazord.dashUntil = 0;
	room.megazord.dashCooldownUntil = 0;
	room.megazord.attackUntil = 0;
	room.megazord.attackCooldownUntil = 0;

	broadcastRoom(room, "spawn_megazord", {
		x: room.megazord.x,
		y: room.megazord.y,
		duration: MEGAZORD_DURATION_MS
	});

	broadcastRoom(room, "megazord_active", { active: true });

	broadcastRoom(room, "teleport_players", {
		x: room.megazord.x,
		y: room.megazord.y
	});

	broadcastRoom(room, "megazord_state", {
		x: room.megazord.x,
		y: room.megazord.y,
		anim: room.megazord.anim,
		flip_h: room.megazord.flipH,
		attacking: room.megazord.attacking
	});

	systemMessage(room, "Megazord formado.");
}

function endMegazord(room) {
	if (!room || !room.megazord.active) return;

	const finalX = room.megazord.x;
	const finalY = room.megazord.y;

	room.megazord.active = false;
	room.megazord.attacking = false;
	room.megazord.dashDir = "";

	const players = playerlist.getByRoom(room.code);
	for (const p of players) {
		p.x = finalX;
		p.y = finalY;
		p.mode = "normal";
		p.zord_expires_at = 0;
		p.zord_cooldown_until = now() + ZORD_COOLDOWN_MS;
	}

	broadcastRoom(room, "despawn_megazord", {
		x: finalX,
		y: finalY
	});

	broadcastRoom(room, "megazord_active", { active: false });

	broadcastRoom(room, "teleport_players", {
		x: finalX,
		y: finalY
	});

	for (const p of players) {
		broadcastRoom(room, "player_mode", {
			uuid: p.uuid,
			mode: "normal",
			player_data: buildPlayerPayload(p, false)
		});
	}

	systemMessage(room, "Megazord desfeito.");
}

function updateZordTimeouts(room) {
	if (room.megazord.active) return;

	const t = now();
	const players = playerlist.getByRoom(room.code);

	for (const p of players) {
		if (p.mode === "zord" && p.zord_expires_at && t >= p.zord_expires_at) {
			p.mode = "normal";
			p.zord_expires_at = 0;
			p.zord_cooldown_until = now() + ZORD_COOLDOWN_MS;

			broadcastRoom(room, "player_mode", {
				uuid: p.uuid,
				mode: "normal",
				player_data: buildPlayerPayload(p, false)
			});
		}
	}
}

function updateMegazord(room) {
	if (!room.megazord.active) return;

	const t = now();

	if (t >= room.megazord.endTime) {
		endMegazord(room);
		return;
	}

	const dir = getConsensusDirection(room);

	if (dir && t >= room.megazord.dashCooldownUntil) {
		room.megazord.dashDir = dir;
		room.megazord.dashUntil = t + 180;
		room.megazord.dashCooldownUntil = t + 250;
	}

	if (room.megazord.dashDir && t < room.megazord.dashUntil) {
		const v = directionVector(room.megazord.dashDir);
		const dt = TICK_MS / 1000;
		room.megazord.x += v.x * 1200 * dt;
		room.megazord.y += v.y * 1200 * dt;

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
		room.megazord.attackUntil = t + 300;
		room.megazord.attackCooldownUntil = t + 800;
		broadcastRoom(room, "megazord_attack", { attack: true });
	}

	if (room.megazord.attacking && t >= room.megazord.attackUntil) {
		room.megazord.attacking = false;
		broadcastRoom(room, "megazord_attack", { attack: false });
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

function removePlayerFromRoom(socket) {
	const uuid = socket.uuid;
	const roomCode = socket.roomId;
	if (!uuid || !roomCode) return;

	const room = rooms.get(roomCode);
	if (!room) return;

	const player = playerlist.get(uuid);
	const playerName = player ? player.nickname : "Um jogador";

	delete room.players[uuid];
	playerlist.remove(uuid);

	broadcastRoom(room, "player_disconnected", { uuid });
	broadcastRoom(room, "remove_player", { uuid });
	systemMessage(room, `"${playerName}" saiu do jogo.`);

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
		if (room.tickHandle) clearInterval(room.tickHandle);
		rooms.delete(roomCode);
	}

	socket.roomId = "";
}

wss.on("connection", (socket) => {
	const uuid = uuidv4();
	socket.uuid = uuid;
	socket.roomId = "";

	send(socket, "connected", { uuid });

	socket.on("message", (raw) => {
		let msg;
		try {
			msg = JSON.parse(raw.toString());
		} catch (err) {
			send(socket, "server_error", { msg: "JSON inválido", type: "bad_json" });
			return;
		}

		const type = String(msg.type || msg.cmd || "");
		const data = msg.data || msg.content || {};

		switch (type) {
			case "create_room": {
				const room = createRoom();
				socket.roomId = room.code;
				room.players[uuid] = socket;
				room.creatorUuid = uuid;

				const player = playerlist.add(uuid, room.code, data.nickname, data.player_index);
				room.spawnX = player.x;
				room.spawnY = player.y;

				send(socket, "room_created", { code: room.code });
				send(socket, "spawn_player", {
					player: buildPlayerPayload(player, true),
					local: true
				});
				send(socket, "start_game", {});

				systemMessage(room, `"${player.nickname}" entrou no jogo.`);
				break;
			}

			case "join_room": {
				const code = String(data.code || "").toUpperCase();
				const room = rooms.get(code);

				if (!room) {
					send(socket, "server_error", { msg: "Sala não encontrada", type: "room_not_found" });
					break;
				}

				if (getRoomPlayerCount(room) >= MAX_PLAYERS_PER_ROOM) {
					send(socket, "server_error", { msg: "Sala cheia", type: "room_full" });
					break;
				}

				const nickname = normalizeNick(data.nickname) || "Player";
				const player_index = normalizeColorIndex(data.player_index);

				for (const p of playerlist.getByRoom(code)) {
					if (p.uuid !== uuid && p.nickname.toLowerCase() === nickname.toLowerCase()) {
						send(socket, "server_error", { msg: "Nick já escolhido.", type: "nickname_taken" });
						return;
					}
					if (p.uuid !== uuid && normalizeColorIndex(p.player_index) === player_index) {
						send(socket, "server_error", { msg: "Cor já selecionada.", type: "color_taken" });
						return;
					}
				}

				socket.roomId = code;
				room.players[uuid] = socket;

				const player = playerlist.add(uuid, code, nickname, player_index);

				send(socket, "room_joined", { code });
				sendRoomSnapshotToJoiner(socket, room, uuid);

				send(socket, "spawn_player", {
					player: buildPlayerPayload(player, true),
					local: true
				});

				broadcastRoom(room, "spawn_player", {
					player: buildPlayerPayload(player, false),
					local: false
				}, uuid);

				send(socket, "start_game", {});

				systemMessage(room, `"${player.nickname}" entrou no jogo.`);
				break;
			}

			case "leave_room": {
				removePlayerFromRoom(socket);
				break;
			}

			case "request_zord":
			case "spawn_zord": {
				if (!socket.roomId) break;
				const room = rooms.get(socket.roomId);
				if (!room) break;

				const player = playerlist.get(uuid);
				if (!player) break;

				if (player.mode === "zord") break;
				if (player.zord_cooldown_until && now() < player.zord_cooldown_until) {
					send(socket, "server_error", { msg: "Zord em recarga.", type: "zord_cooldown" });
					break;
				}

				player.mode = "zord";
				player.zord_expires_at = now() + ZORD_DURATION_MS;

				broadcastRoom(room, "player_mode", {
					uuid: player.uuid,
					mode: "zord",
					player_data: buildPlayerPayload(player, false)
				});

				systemMessage(room, `"${player.nickname}" chamou o Zord.`);

				if (!room.megazord.active && allPlayersInZord(room)) {
					spawnMegazord(room);
				}
				break;
			}

			case "zord_finished":
			case "despawn_zord": {
				if (!socket.roomId) break;
				const room = rooms.get(socket.roomId);
				if (!room) break;

				const player = playerlist.get(uuid);
				if (!player) break;

				player.mode = "normal";
				player.zord_expires_at = 0;
				player.zord_cooldown_until = now() + ZORD_COOLDOWN_MS;

				broadcastRoom(room, "player_mode", {
					uuid: player.uuid,
					mode: "normal",
					player_data: buildPlayerPayload(player, false)
				});
				break;
			}

			case "player_state": {
				if (!socket.roomId) break;
				const room = rooms.get(socket.roomId);
				if (!room) break;

				const player = playerlist.get(uuid);
				if (!player) break;

				const oldShield = player.shield;

				const patch = {
					x: Number(data.x ?? data.content?.x) || player.x,
					y: Number(data.y ?? data.content?.y) || player.y,
					anim: String(data.anim ?? data.content?.anim ?? player.anim),
					flip_h: !!(data.flip_h ?? data.content?.flip_h),
					shield: !!(data.shield ?? data.content?.shield),
					attacking: !!(data.attacking ?? data.content?.attacking),
					player_index: normalizeColorIndex(data.player_index ?? data.content?.player_index ?? player.player_index),
					nickname: normalizeNick(data.nickname ?? data.content?.nickname) || player.nickname
				};

				players.update(uuid, patch);

				if (player.uuid === room.creatorUuid) {
					room.spawnX = patch.x;
					room.spawnY = patch.y;
				}

				if (!oldShield && patch.shield) {
					systemMessage(room, `"${player.nickname}" pegou o escudo.`);
				}

				broadcastRoom(room, "player_state", {
					uuid,
					...patch
				});
				break;
			}

			case "player_event": {
				if (!socket.roomId) break;
				const room = rooms.get(socket.roomId);
				if (!room) break;

				const player = playerlist.get(uuid);
				if (!player) break;

				const event = String(data.event || data.content?.event || "");

				if (event === "shield_picked") {
					const oldShield = player.shield;
					player.shield = true;

					if (!oldShield) {
						systemMessage(room, `"${player.nickname}" pegou o escudo.`);
					}

					broadcastRoom(room, "player_state", {
						uuid: player.uuid,
						x: player.x,
						y: player.y,
						anim: player.anim,
						flip_h: player.flip_h,
						shield: true,
						attacking: player.attacking,
						player_index: player.player_index,
						nickname: player.nickname
					});
				}
				break;
			}

			case "position": {
				if (!socket.roomId) break;
				const room = rooms.get(socket.roomId);
				if (!room) break;

				const x = Number(data.x ?? data.content?.x) || 0;
				const y = Number(data.y ?? data.content?.y) || 0;
				playerlist.update(uuid, { x, y });

				const player = playerlist.get(uuid);
				if (player && player.uuid === room.creatorUuid) {
					room.spawnX = x;
					room.spawnY = y;
				}

				broadcastRoom(room, "update_position", { uuid, x, y }, uuid);
				break;
			}

			case "zord_state": {
				if (!socket.roomId) break;
				const room = rooms.get(socket.roomId);
				if (!room) break;

				const player = playerlist.get(uuid);
				if (!player) break;

				playerlist.update(uuid, {
					x: Number(data.x ?? data.content?.x) || player.x,
					y: Number(data.y ?? data.content?.y) || player.y,
					anim: String(data.anim ?? data.content?.anim ?? player.anim),
					flip_h: !!(data.flip_h ?? data.content?.flip_h),
					attacking: !!(data.attacking ?? data.content?.attacking)
				});

				broadcastRoom(room, "zord_state", {
					uuid,
					x: Number(data.x ?? data.content?.x) || 0,
					y: Number(data.y ?? data.content?.y) || 0,
					anim: String(data.anim ?? data.content?.anim ?? "idle_down"),
					flip_h: !!(data.flip_h ?? data.content?.flip_h),
					attacking: !!(data.attacking ?? data.content?.attacking),
					player_index: player.player_index,
					nickname: player.nickname
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
					left: !!(data.left ?? data.content?.left),
					right: !!(data.right ?? data.content?.right),
					up: !!(data.up ?? data.content?.up),
					down: !!(data.down ?? data.content?.down),
					attack: !!(data.attack ?? data.content?.attack)
				};
				break;
			}

			case "chat": {
				if (!socket.roomId) break;
				const room = rooms.get(socket.roomId);
				if (!room) break;

				const player = playerlist.get(uuid);
				if (!player) break;

				const text = String(data.message ?? data.content?.message ?? "").trim();
				if (!text) break;

				broadcastRoom(room, "chat", {
					message: `${player.nickname}: ${text}`,
					system: false
				});
				break;
			}

			default:
				console.log("Comando desconhecido:", type);
				console.log("Conteúdo:", data);
				break;
		}
	});

	socket.on("close", () => {
		removePlayerFromRoom(socket);
	});
});
