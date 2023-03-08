const { request } = require("../lib/request");
const handlebars = require("handlebars");
const { getResponseResult } = require("./parser");
const { Exception } = require("handlebars");
const { encode } = require("gpt-3-encoder");

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_PROMPT_TOKEN_RATIO = 0.5;

// register functions that can be called directly in the prompt markdown
handlebars.registerHelper('stripHTML', function(value) {
    return value.replace(/<[^>]*>/g, '');
    });

handlebars.registerHelper('now', function() {
    return new Date().toISOString();
    });
    
class PathwayPrompter {
    constructor({ config, pathway }) {
        // If the pathway specifies a model, use that, otherwise use the default
        this.modelName = pathway.model || config.get('defaultModelName');
        // Get the model from the config
        this.model = config.get('models')[this.modelName];
        // If the model doesn't exist, throw an exception
        if (!this.model) {
            throw new Exception(`Model ${this.modelName} not found in config`);
        }
        this.environmentVariables = config.getEnv();
        this.temperature = pathway.temperature;
        this.pathwayPrompt = pathway.prompt;
        this.pathwayName = pathway.name;
        this.promptParameters = {}
        // Make all of the parameters defined on the pathway itself available to the prompt
        for (const [k, v] of Object.entries(pathway)) {
            this.promptParameters[k] = v.default ?? v;
        }
        if (pathway.inputParameters) {
            for (const [k, v] of Object.entries(pathway.inputParameters)) {
                this.promptParameters[k] = v.default ?? v;
            }
        }
        this.requestCount = 1
        this.shouldCache = config.get('enableCache') && (pathway.enableCache || pathway.temperature == 0);
    }

    getModelMaxTokenLength() {
        return (this.promptParameters.maxTokenLength ?? this.model.maxTokenLength ?? DEFAULT_MAX_TOKENS);
    }

    getPromptTokenRatio() {
        return this.promptParameters.inputParameters.tokenRatio ?? this.promptParameters.tokenRatio ?? DEFAULT_PROMPT_TOKEN_RATIO;
    }

    requestUrl() {
        const generateUrl = handlebars.compile(this.model.url);
        return generateUrl({ ...this.model, ...this.environmentVariables, ...this.config });
    }

    requestParameters(text, parameters, prompt) {
        let promptText;
        if (typeof (prompt) === 'function') {
            promptText = prompt(parameters);
        }
        else {
            promptText = prompt;
        }

        const interpolatePrompt = handlebars.compile(promptText);

        const combinedParameters = { ...this.promptParameters, ...parameters };
        const constructedPrompt = interpolatePrompt({ ...combinedParameters, text });
        let params = {};

        if (this.model.type === 'OPENAI_CHAT') {
            params = {
                messages: [ {"role": "user", "content": constructedPrompt} ],
                temperature: this.temperature ?? 0.7,
            }
        } else {
            params = {
                prompt: constructedPrompt,
                max_tokens: this.getModelMaxTokenLength() - encode(constructedPrompt).length - 1,
                // model: "text-davinci-002",
                temperature: this.temperature ?? 0.7,
                // "top_p": 1,
                // "n": 1,
                // "presence_penalty": 0,
                // "frequency_penalty": 0,
                // "best_of": 1,
            }
        }

        // return { ...defaultParams, ...overrideParams };
        return params;
    }

    async execute(text, parameters, prompt) {
        const requestParameters = this.requestParameters(text, parameters, prompt);

        const url = this.requestUrl(text);
        const params = { ...(this.model.params || {}), ...requestParameters }
        const headers = this.model.headers || {};
        const data = await request({ url, params, headers, cache:this.shouldCache }, this.modelName);
        const modelInput = params.prompt || params.messages[0].content;
        const responseResult = getResponseResult(data);
        
        console.log(`=== ${this.pathwayName}.${this.requestCount++} ===`)
        console.log(`\x1b[36m${modelInput}\x1b[0m`)
        console.log(`\x1b[34m> ${responseResult}\x1b[0m`)

        if (data.error) {
            throw new Exception(`An error was returned from the server: ${JSON.stringify(data.error)}`);
        }

        return responseResult;
    }
}

module.exports = {
    PathwayPrompter
}
