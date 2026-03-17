

import {
  VoiceRequest,
  VoiceResponse,
  SupportedLanguage,
  EnglishSTTFn,
  TwiSTTFn,
  TwiToEnglishFn,
  EnglishToTwiFn,
  EnglishTTSFn,
  TwiTTSFn,
  AssistantResponse,
} from "@features/assistant/types";



export type AssistantFn = (
  englishText: string,
  userId: string
) => Promise<AssistantResponse>;


export interface VoicePipelineDeps {
  assistantFn: AssistantFn;
  englishSTT: EnglishSTTFn;
  twiSTT: TwiSTTFn;
  twiToEnglish: TwiToEnglishFn;
  englishToTwi: EnglishToTwiFn;
  englishTTS: EnglishTTSFn;
  twiTTS: TwiTTSFn;
}


export class VoicePipeline {
  constructor(private readonly deps: VoicePipelineDeps) {}

  async process(req: VoiceRequest): Promise<VoiceResponse> {
    const { userId, language, audio } = req;

    if (language === "english") {
      return this.processEnglish(audio, userId);
    } else {
      return this.processTwi(audio, userId);
    }
  }


  private async processEnglish(
    audio: Buffer,
    userId: string
  ): Promise<VoiceResponse> {

    const englishText = await this.deps.englishSTT(audio);
    log("english:stt", englishText);

    const assistantResponse = await this.deps.assistantFn(englishText, userId);
    const englishResponseText = assistantResponse.message;
    log("english:assistant", englishResponseText);


    const responseAudio = await this.deps.englishTTS(englishResponseText);
    log("english:tts", `${responseAudio.length} bytes`);

    return {
      audio: responseAudio,
      englishText: englishResponseText,
      spokenText: englishResponseText,
      language: "english",
      toolsUsed: assistantResponse.toolsUsed,
    };
  }


  private async processTwi(
    audio: Buffer,
    userId: string
  ): Promise<VoiceResponse> {

    const twiTranscript = await this.deps.twiSTT(audio);
    log("twi:stt", twiTranscript);


    const englishQuery = await this.deps.twiToEnglish(twiTranscript);
    log("twi→en:translate", englishQuery);


    const assistantResponse = await this.deps.assistantFn(englishQuery, userId);
    const englishResponseText = assistantResponse.message;
    log("twi:assistant", englishResponseText);


    const twiResponseText = await this.deps.englishToTwi(englishResponseText);
    log("en→twi:translate", twiResponseText);

    const responseAudio = await this.deps.twiTTS(twiResponseText);
    log("twi:tts", `${responseAudio.length} bytes`);

    return {
      audio: responseAudio,
      englishText: englishResponseText,
      spokenText: twiResponseText,
      language: "twi",
      toolsUsed: assistantResponse.toolsUsed,
    };
  }
}


function log(step: string, value: string): void {
  console.log(`  [voice:${step}] ${value}`);
}