// ========================================
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

		default:


			console.log(
				"Comando desconhecido:",
				type
			);


			break;


		}

	});




// ========================================
// DESCONEXÃO
// ========================================

	socket.on("close",()=>{


		console.log(
			"Cliente saiu:",
			uuid
		);



		const player =
			players.get(uuid);



		const room =
			rooms.get(
				socket.roomId
			);



		if(player && room){


			sendMessage(
				room,
				player.nickname+
				" saiu do jogo"
			);



			broadcast(
				room,
				"remove_player",
				{
					uuid:uuid
				}
			);



		}



		players.remove(uuid);



		if(room){


			delete room.players[uuid];



			if(
				Object.keys(room.players)
				.length === 0
			){

				rooms.delete(
					room.code
				);


				console.log(
					"Sala removida:",
					room.code
				);

			}

		}


	});


});
