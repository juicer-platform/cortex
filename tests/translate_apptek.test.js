import test from 'ava';
import sinon from 'sinon';
import { PathwayResolver } from '../server/pathwayResolver.js';
import translate_apptek from '../pathways/translate_apptek.js';
import { config } from '../config.js';

// Mock configuration
const mockModel = {
    name: 'apptek-translate',
    type: 'APPTEK-TRANSLATE',
    apiEndpoint: 'https://api.mock-apptek.com'
};

test.beforeEach((t) => {
    // Create a sinon sandbox
    t.context.sandbox = sinon.createSandbox();
    
    // Create config mock
    t.context.mockConfig = {
        get: (key) => {
            const configs = {
                models: {
                    'apptek-translate': mockModel
                },
                'models.apptek-translate': mockModel,
                defaultModelName: 'apptek-translate'
            };
            return configs[key];
        },
        getEnv: () => ({}),
        models: {
            'apptek-translate': mockModel
        }
    };
    
    // Create a fresh copy of the pathway
    t.context.pathway = {
        name: 'translate_apptek',
        model: 'apptek-translate',
        temperature: 0,
        timeout: 120,
        prompt: '{{{text}}}',
        inputParameters: {
            from: 'auto',
            to: 'en',
        }
    };
    
    // Setup basic arguments
    t.context.args = {
        text: 'Hello, how are you?',
        from: 'en',
        to: 'es'
    };
    
    // Create resolver instance
    t.context.resolver = new PathwayResolver({
        config: t.context.mockConfig,
        pathway: t.context.pathway,
        args: t.context.args,
        endpoints: {
            translate: {
                resolve: t.context.sandbox.stub().resolves('translated text')
            }
        }
    });
});

test.afterEach.always((t) => {
    // Restore sandbox
    t.context.sandbox.restore();
});

test('pathway has correct basic configuration', (t) => {
    const pathway = t.context.pathway;
    
    t.is(pathway.temperature, 0);
    t.is(pathway.model, 'apptek-translate');
    t.is(pathway.timeout, 120);
    t.is(typeof pathway.prompt, 'string');
});

test('pathway has correct input parameters', (t) => {
    const pathway = t.context.pathway;
    
    t.is(pathway.inputParameters.from, 'auto');
    t.is(pathway.inputParameters.to, 'en');
    t.is(pathway.inputParameters.tokenRatio, 0.2);
});

test('pathway has correct AppTek configuration', (t) => {
    const pathway = t.context.pathway;
    
    t.is(pathway.config.maxPollingAttempts, 30);
    t.is(pathway.config.pollingInterval, 1.0);
    t.deepEqual(pathway.config.supportedLanguages, {
        en: "English",
        es: "Spanish",
        ar: "Arabic",
        fr: "French",
        it: "Italian"
    });
});

test('resolver processes text correctly', async (t) => {
    const resolver = t.context.resolver;
    const result = await resolver.processInputText('Hello, how are you?');
    t.is(result, 'Hello, how are you?');
});

test('resolver handles empty text', async (t) => {
    const resolver = t.context.resolver;
    const result = await resolver.processInputText('');
    t.is(result, '');
});

test('resolver uses correct model', (t) => {
    const resolver = t.context.resolver;
    const model = resolver.getModel();
    t.deepEqual(model, mockModel);
});
