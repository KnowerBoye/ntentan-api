import express from "express" 
import dotenv from "dotenv"
import {Server} from "socket.io"
import {createServer} from "http"
import {handleVideoStreamConnection} from "@features/medication-scanner/medscanner.service"
import { handleAssistantSocket } from "./features/assistant/assistant.service"

dotenv.config()

const app = express()
const server = createServer(app)


const io = new Server(server)



io.of("/assistant").on("connection" , handleAssistantSocket)
io.of("/med-scanner").on("connection" , handleVideoStreamConnection)



const PORT = process.env.PORT || 8080
server.listen(PORT, ()=>console.log(`Server running on ${PORT}`))

