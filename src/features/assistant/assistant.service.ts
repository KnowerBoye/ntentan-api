import { ChatMessage, UserMessage  } from "@/types/assistant";
import { MedicalAssistant } from "@features/assistant/assistant";
import dotenv from "dotenv"
import { Socket } from "socket.io";
import { handleTwiAudio, twiToEnglish } from "./voice.service";

dotenv.config()

export async function getAgentResponse(
    input : {
        content : string | Buffer , 
        type : "text" | "audio"
    }
){


    const assistant = new MedicalAssistant(process.env.GEMINI_API_KEY || "")




}


export async function handleAssistantSocket(clientWs : Socket){

    console.log("assistant connected")
    

    //temp store history in memory for mvp move to memory store or db later

    const history : ChatMessage[] = []

    const assistant = new MedicalAssistant(process.env.GEMINI_API_KEY || "")

    clientWs.on("message" , async (message : UserMessage) =>{


  
        try{

            const query : UserMessage = {
                type : "text"  , 
                content : "" , 
                language : message.language
            }
    
            history.push({
                ...message , 
                role : "user" , 
            })

            if(message.type == "audio"){
    
                if(message.language == "twi"){
                    query.type = "text" 
                    query.content = await handleTwiAudio(message.content)
                }
    
                else {
                    query.type = "audio"
                    query.content = message.content
                }
    
    
            }
    
            else { 
    
                if(message.language == "twi") query.content = await twiToEnglish(message.content)
                else query.content = message.content
    
                query.type = "text" 
    
            }
    
           
            console.log(query)
            const response = await assistant.chat(query , "uid" ,  history)

            console.log(response)

            clientWs.emit("response" , response)
            
            history.push({
                content : response.message , 
                role : "assistant" , 
                language : "english" , 
                type : "text"
            })

        }catch(e){
            clientWs.emit("error" , "An unexpected server error occured")
            clientWs.disconnect()
            history.length = 0
            //do sentry log
        }

        



    })
}