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
		result += chars[Math.floor(Math.random() * chars.length)];
	}

	return result;
}



const playerlist = {

	players: [],


	add(uuid, room) {

		const players = this.getByRoom(room);

		const first = players.length === 0;


		const player = {

			uuid: uuid,

			room: room,

			x: first ? 550 : 700,

			y: 300

		};


		this.players.push(player);

		return player;

	},


	get(uuid) {

		return this.players.find(p => p.uuid === uuid);

	},


	update(uuid, x, y) {

		const player = this.get(uuid);

		if(player){

			player.x = x;
			player.y = y;

		}

	},


	remove(uuid){

		this.players =
		this.players.filter(p => p.uuid !== uuid);

	},


	getByRoom(room){

		return this.players.filter(p => p.room === room);

	}

};




wss.on("connection", socket => {


	const uuid = uuidv4();

	socket.uuid = uuid;


	console.log("Cliente conectado:", uuid);



	socket.send(JSON.stringify({

		cmd:"joined_server",

		content:{
			uuid:uuid
		}

	}));





	socket.on("message", message => {


		let data;


		try{

			data = JSON.parse(message.toString());

		}catch(e){

			console.log("JSON inválido");

			return;

		}




		switch(data.cmd){



			case "create_room":


				const roomCode = generateRoomCode();


				socket.roomId = roomCode;


				rooms.set(roomCode,{

					players:{}

				});


				rooms.get(roomCode).players[uuid] = socket;



				const player = playerlist.add(uuid, roomCode);



				console.log("Sala criada:", roomCode);



				socket.send(JSON.stringify({

					cmd:"room_created",

					content:{
						code:roomCode
					}

				}));


				socket.send(JSON.stringify({

					cmd:"spawn_local_player",

					content:{
						player:player
					}

				}));


				socket.send(JSON.stringify({

					cmd:"start_game",

					content:{}

				}));


			break;





			case "join_room":


				const code = data.content.code.toUpperCase();


				const room = rooms.get(code);



				if(!room){

					socket.send(JSON.stringify({

						cmd:"error",

						content:{
							msg:"Sala não encontrada"
						}

					}));

					return;

				}




				if(Object.keys(room.players).length >= MAX_PLAYERS_PER_ROOM){


					socket.send(JSON.stringify({

						cmd:"error",

						content:{
							msg:"Sala cheia"
						}

					}));

					return;

				}





				socket.roomId = code;


				room.players[uuid] = socket;



				const newPlayer = playerlist.add(uuid, code);



				console.log("Jogador entrou:", uuid);





				socket.send(JSON.stringify({

					cmd:"room_joined",

					content:{
						code:code
					}

				}));





				socket.send(JSON.stringify({

					cmd:"spawn_local_player",

					content:{
						player:newPlayer
					}

				}));





				const oldPlayers = playerlist
				.getByRoom(code)
				.filter(p=>p.uuid !== uuid);



				socket.send(JSON.stringify({

					cmd:"spawn_network_players",

					content:{
						players:oldPlayers
					}

				}));





				for(const id in room.players){


					const client = room.players[id];


					if(client !== socket &&
					client.readyState === WebSocket.OPEN){


						client.send(JSON.stringify({

							cmd:"spawn_new_player",

							content:{
								player:newPlayer
							}

						}));

					}

				}




				for(const id in room.players){


					const client = room.players[id];


					if(client.readyState === WebSocket.OPEN){


						client.send(JSON.stringify({

							cmd:"start_game",

							content:{}

						}));


					}

				}


			break;






			case "position":


				playerlist.update(

					uuid,

					data.content.x,

					data.content.y

				);



				const playerRoom = rooms.get(socket.roomId);



				if(playerRoom){


					for(const id in playerRoom.players){


						const client = playerRoom.players[id];


						if(client !== socket &&
						client.readyState === WebSocket.OPEN){


							client.send(JSON.stringify({

								cmd:"update_position",

								content:{

									uuid:uuid,

									x:data.content.x,

									y:data.content.y

								}

							}));

						}

					}

				}


			break;





			case "chat":


				const chatRoom = rooms.get(socket.roomId);


				if(chatRoom){


					for(const id in chatRoom.players){


						const client = chatRoom.players[id];


						if(client.readyState === WebSocket.OPEN){


							client.send(JSON.stringify({

								cmd:"new_chat_message",

								content:{

									uuid:uuid,

									msg:data.content.msg

								}

							}));

						}

					}

				}


			break;



		}



	});






	socket.on("close",()=>{


		console.log("Saiu:",uuid);



		playerlist.remove(uuid);



		const room = rooms.get(socket.roomId);



		if(room){


			delete room.players[uuid];



			for(const id in room.players){


				const client = room.players[id];


				if(client.readyState === WebSocket.OPEN){


					client.send(JSON.stringify({

						cmd:"player_disconnected",

						content:{
							uuid:uuid
						}

					}));

				}

			}




			if(Object.keys(room.players).length === 0){

				rooms.delete(socket.roomId);

				console.log("Sala removida");

			}


		}



	});


});
