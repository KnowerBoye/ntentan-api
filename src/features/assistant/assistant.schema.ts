import {z} from "zod"



const ContentType = z.enum(["user" , "assistant"])

export const QueryAgentSchema = z.object({
    body : z.object({
    history : z.array(
        z.object({
        content : z.string({error : "Invalid content"}),
        type : ContentType, 
        role : z.enum(["user" , "assistant"])
    })
    ) , 
    query : z.object({
        content : z.string() , 
        type : ContentType 
    }) ,

    languague : z.enum(["twi" , "eng"] , {
        error : "Language must be one of twi | english" })


}
)

})