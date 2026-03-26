import { NextFunction, Request, Response } from "express"
import {ZodError  } from "zod"
import { InferSchema , RequestSchema } from "@/types/request-schema"



export default function<T extends RequestSchema>(schema : T){


    return function(req : Request , res : Response , next : NextFunction){
        try{

        
            const validated = schema.parse({
                body : req.body , 
                query : req.query , 
                params : req.params
            })


            req.validated = validated as InferSchema<T>


            next()
        }
 
        catch(e : ZodError | any){

        
            let message = "Invalid request data"
            
            if (e instanceof ZodError) {
                message = e.issues[0]?.message ?? message
            }

            console.error(e)

            return res.status(400).json({
                status: "error",
                message,
            })
        }
    }
}
