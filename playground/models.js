// list-models.js
const {GoogleGenAI}= require("@google/genai");

const devn = require("dotenv")

devn.config()

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

ai.models.list().then(async function(models){

    for await (const model of models) {
      if (model.supportedActions?.includes("bidiGenerateContent")) {
        console.log("✅ Live API:", model.name);
      }
    }

});