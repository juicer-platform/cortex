import logger from "../lib/logger.js";
import { publishRequestProgress } from "../lib/redisSubscription.js";
import { alignSubtitles, getMediaChunks } from "../lib/util.js";
import { Prompt } from "../server/prompt.js";

const OFFSET_CHUNK = 500; //seconds of each chunk offset, only used if helper does not provide

export default {
    prompt:
    [
        new Prompt({ messages: [
            "{{messages}}",
        ]}),
    ],
    model: 'gemini-flash-20-vision',
    inputParameters: {
        file: ``,
        language: ``,
        responseFormat: `text`,
        wordTimestamped: false,
        highlightWords: false,
        maxLineWidth: 0,
        maxLineCount: 0,
        maxWordsPerLine: 0,
        contextId: ``,
    },
    timeout: 3600, // in seconds
    enableDuplicateRequests: false,

    executePathway: async ({args, runAllPrompts, resolver}) => {
        let intervalId;
        const { requestId } = resolver;

        try{
        let totalCount = 11; //init max chunk value
        let completedCount = 0;
        let partialCount = 0;
        let partialRatio = 0;

        const sendProgress = (partial=false, resetCount=false) => {
            partialCount = resetCount ? 0 : partialCount;

            if(partial){
                partialCount++;
                const increment = 0.02 / Math.log2(partialCount + 1); // logarithmic diminishing increment
                partialRatio = Math.min(partialRatio + increment, 0.99); // limit to 0.99
            }else{
                partialCount = 0;
                partialRatio = 0;
                completedCount++;
            }
            if(completedCount >= totalCount) return;

            const progress = (completedCount + partialRatio) / totalCount;
            logger.info(`Progress for ${requestId}: ${progress}`);

            publishRequestProgress({
                requestId,
                progress,
                data: null,
            });
        }
        sendProgress(true);
        intervalId = setInterval(() => sendProgress(true), 3000);

        const { file, responseFormat, wordTimestamped, maxLineWidth } = args;
        if(!file) {
            throw new Error("Please provide a file to transcribe.");
        }


        //check if fils is a gcs file or youtube
        const isGcs = file.startsWith('gs://');
        const isYoutube = file.match(/^(http(s)?:\/\/)?((w){3}.)?youtu(be|.be)?(\.com)?\/.+/);

        let chunks = [{
            url: file,
            gcs: file,
            offset: 0,
        }];
        if(!isGcs && !isYoutube) {
            //get chunks from helper api if not gcs or youtube
            chunks = await getMediaChunks(file, requestId);
        }
        totalCount = chunks.length+1;
        logger.info(`Processing chunks: ${JSON.stringify(chunks)}`);

        sendProgress(true);

        let respectLimitsPrompt = " ";
        if (maxLineWidth) {

            const possiblePlacement = maxLineWidth <= 25
            ? "vertical" : maxLineWidth <= 35 ? "horizontal" : "";

            respectLimitsPrompt += `The output lines must not exceed ${maxLineWidth} characters, so make sure your transcription lines and timestamps are perfectly aligned. `;

            if(possiblePlacement){
                respectLimitsPrompt+= `This limit a must as user will be using the output for ${possiblePlacement} display.`
            }
        }

        const transcriptionLevel = wordTimestamped ? "word" : "phrase";

        function getMessages(file, format) {

            const responseFormat = format!== 'text' ? 'VTT' : 'text';

            const messages = [
                {"role": "system", "content": `Instructions:\nYou are an AI entity with expertise of transcription. Your response only contains the transcription, no comments or additonal stuff. 
                
Your output must be in the format asked, and must be strictly following the formats and parseble by auto parsers. 

Word-level transcriptions must be per word timestamped, and phrase-level transcriptions are per phrase.

Each transcription timestamp must precisely match the corresponding audio/video segment.
Each timestamp must correspond to actual spoken content.
End time cannot exceed total media duration. Especially when transcribing word-level double check your timestamps, never exceed the total duration. 

You must follow 1, 2, 3, ... numbering for each transcription segment without any missing numbers.
Never put newlines or spaces in the middle of a timestamp.
Never put multiple lines for a single timestamp.

Example responses:

- If asked SRT format, e.g.:
1
00:00:00,498 --> 00:00:02,827
Hello World!

2
00:00:02,827 --> 00:00:06,383
Being AI is fun!

- If asked VTT format, e.g.:
WEBVTT

1
00:00:00.000 --> 00:00:02.944
Hello World2!

2
00:00:05.344 --> 00:00:08.809
Being AI is also great!

- If asked text format, e.g.:
Hello World!!! Being AI is being great yet again!

Word-level output e.g.:

WEBVTT

1
00:00:00.000 --> 00:00:01.944
Hello

2
00:00:01.964 --> 00:00:02.383
World!


You must follow spacing, punctuation, and timestamps as shown in the examples otherwise your response will not be accepted.
Never output multiple lines for a single timestamp.
Even a single newline or space can cause the response to be rejected. You must follow the format strictly. You must place newlines and timestamps exactly as shown in the examples.

    `},
                {"role": "user", "content": [
                    `{ type: 'text', text: 'Transcribe the media ${transcriptionLevel}-level in ${responseFormat} format.${respectLimitsPrompt}' }`,
                    JSON.stringify({
                        type: 'image_url',
                        url: file,
                        gcs: file
                    })
                ]},
            ]

            return messages;
        }


        const processChunksParallel = async (chunks, args) => {
            try {
                const chunkPromises = chunks.map(async (chunk, index) => ({
                    index,
                    result: await runAllPrompts({ 
                        ...args, 
                        messages: getMessages(chunk.gcs || chunk.uri, responseFormat),
                        requestId: `${requestId}-${index}`
                    })
                }));
        
                const results = await Promise.all(
                chunkPromises.map(promise => 
                    promise.then(result => {
                        sendProgress();
                        return result;
                    })
                ));

                return results
                    .sort((a, b) => a.index - b.index)
                    .map(item => item.result);
            } catch (error) {
                logger.error('Error processing chunks:', error);
                throw error;
            }
        };
       
        // serial processing of chunks
        // const result = [];
        // for(const chunk of chunks) {
        //     const chunkResult = await runAllPrompts({ ...args, messages: getMessages(chunk.gcs || chunk.uri) });
        //     result.push(chunkResult);
        // }
        
        const result = await processChunksParallel(chunks, args);
        
        if (['srt','vtt'].includes(responseFormat) || wordTimestamped) { // align subtitles for formats
            const offsets = chunks.map((chunk, index) => chunk?.offset || index * OFFSET_CHUNK);
            return alignSubtitles(result, responseFormat, offsets);
        }
        return result.join(` `);
    }catch(error){
        logger.error(`Error in transcribing: ${error}`);
        throw error;
    }finally{
        intervalId && clearInterval(intervalId);
    }
    }
};
