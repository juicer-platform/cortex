// OpenAIChatPlugin.js
import ModelPlugin from './modelPlugin.js';
import { encode } from 'gpt-3-encoder';
import logger from '../../lib/logger.js';

class OpenAIChatPlugin extends ModelPlugin {
    constructor(config, pathway, modelName, model) {
        super(config, pathway, modelName, model);
    }

    // convert to OpenAI messages array format if necessary
    convertPalmToOpenAIMessages(context, examples, messages) {
        let openAIMessages = [];
        
        // Add context as a system message
        if (context) {
            openAIMessages.push({
            role: 'system',
            content: context,
            });
        }
        
        // Add examples to the messages array
        examples.forEach(example => {
            openAIMessages.push({
            role: example.input.author || 'user',
            content: example.input.content,
            });
            openAIMessages.push({
            role: example.output.author || 'assistant',
            content: example.output.content,
            });
        });
        
        // Add remaining messages to the messages array
        messages.forEach(message => {
            openAIMessages.push({
            role: message.author,
            content: message.content,
            });
        });
        
        return openAIMessages;
    }

    // Set up parameters specific to the OpenAI Chat API
    getRequestParameters(text, parameters, prompt) {
        const { modelPromptText, modelPromptMessages, tokenLength, modelPrompt } = this.getCompiledPrompt(text, parameters, prompt);
        const { stream } = parameters;
    
        // Define the model's max token length
        const modelTargetTokenLength = this.getModelMaxTokenLength() * this.getPromptTokenRatio();
    
        let requestMessages = modelPromptMessages || [{ "role": "user", "content": modelPromptText }];
        
        // Check if the messages are in Palm format and convert them to OpenAI format if necessary
        const isPalmFormat = requestMessages.some(message => 'author' in message);
        if (isPalmFormat) {
            const context = modelPrompt.context || '';
            const examples = modelPrompt.examples || [];
            requestMessages = this.convertPalmToOpenAIMessages(context, examples, modelPromptMessages);
        }
    
        // Check if the token length exceeds the model's max token length
        if (tokenLength > modelTargetTokenLength) {
            // Remove older messages until the token length is within the model's limit
            requestMessages = this.truncateMessagesToTargetLength(requestMessages, modelTargetTokenLength);
        }
    
        const requestParameters = {
        messages: requestMessages,
        temperature: this.temperature ?? 0.7,
        ...(stream !== undefined ? { stream } : {}),
        };
    
        return requestParameters;
    }

    // Execute the request to the OpenAI Chat API
    async execute(text, parameters, prompt, pathwayResolver) {
        const url = this.requestUrl(text);
        const requestParameters = this.getRequestParameters(text, parameters, prompt);
        const { requestId, pathway} = pathwayResolver;

        const data = { ...(this.model.params || {}), ...requestParameters };
        const params = {}; // query params
        const headers = this.model.headers || {};
        return this.executeRequest(url, data, params, headers, prompt, requestId, pathway);
    }

    // Parse the response from the OpenAI Chat API
    parseResponse(data) {
        const { choices } = data;
        if (!choices || !choices.length) {
            return data;
        }

        // if we got a choices array back with more than one choice, return the whole array
        if (choices.length > 1) {
            return choices;
        }

        // otherwise, return the first choice
        const messageResult = choices[0].message && choices[0].message.content && choices[0].message.content.trim();
        return messageResult ?? null;
    }

    // Override the logging function to display the messages and responses
    logRequestData(data, responseData, prompt) {
        this.logAIRequestFinished();
    
        const { stream, messages } = data;
        if (messages && messages.length > 1) {
            logger.info(`[chat request sent containing ${messages.length} messages]`);
            let totalTokens = 0;
            messages.forEach((message, index) => {
                //message.content string or array
                const content = Array.isArray(message.content) ? message.content.map(item => JSON.stringify(item)).join(', ') : message.content;
                const words = content.split(" ");
                const tokenCount = encode(content).length;
                const preview = words.length < 41 ? content : words.slice(0, 20).join(" ") + " ... " + words.slice(-20).join(" ");
    
                logger.debug(`Message ${index + 1}: Role: ${message.role}, Tokens: ${tokenCount}, Content: "${preview}"`);
                totalTokens += tokenCount;
            });
            logger.info(`[chat request contained ${totalTokens} tokens]`);
        } else {
            const message = messages[0];
            const content = Array.isArray(message.content) ? message.content.map(item => JSON.stringify(item)).join(', ') : message.content;
            const tokenCount = encode(content).length;
            logger.info(`[request sent containing ${tokenCount} tokens]`);
            logger.debug(`${content}`);
        }
    
        if (stream) {
            logger.info(`[response received as an SSE stream]`);
        } else {
            const responseText = this.parseResponse(responseData);
            const responseTokens = encode(responseText).length;
            logger.info(`[response received containing ${responseTokens} tokens]`);
            logger.debug(`${responseText}`);
        }

        prompt && prompt.debugInfo && (prompt.debugInfo += `\n${JSON.stringify(data)}`);
    }
}

export default OpenAIChatPlugin;
