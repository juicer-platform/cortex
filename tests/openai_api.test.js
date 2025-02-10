// openai_api.test.js

import test from 'ava';
import got from 'got';
import axios from 'axios';
import serverFactory from '../index.js';

const API_BASE = `http://localhost:${process.env.CORTEX_PORT}/v1`;

let testServer;

test.before(async () => {
  process.env.CORTEX_ENABLE_REST = 'true';
  const { server, startServer } = await serverFactory();
  startServer && await startServer();
  testServer = server;
});

test.after.always('cleanup', async () => {
  if (testServer) {
    await testServer.stop();
  }
});

test('GET /models', async (t) => {
  const response = await got(`${API_BASE}/models`, { responseType: 'json' });
  t.is(response.statusCode, 200);
  t.is(response.body.object, 'list');
  t.true(Array.isArray(response.body.data));
});

test('POST /completions', async (t) => {
  const response = await got.post(`${API_BASE}/completions`, {
    json: {
      model: 'gpt-3.5-turbo',
      prompt: 'Word to your motha!',
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'text_completion');
  t.true(Array.isArray(response.body.choices));
});


test('POST /chat/completions', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello!' }],
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
});

test('POST /chat/completions with multimodal content', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What do you see in this image?'
          },
          {
            type: 'image',
            image_url: {
              url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABQODxIPDRQSEBIXFRQdHx4eHRoaHSQrJyEwPENBMDQ4NDQ0QUJCSkNLS0tNSkpQUFFQR1BTYWNgY2FQYWFQYWj/2wBDARUXFyAeIBohHh4oIiE2LCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='
            }
          }
        ]
      }],
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
  t.truthy(response.body.choices[0].message.content);
});

async function connectToSSEEndpoint(url, endpoint, payload, t, customAssertions) {
    return new Promise(async (resolve, reject) => {
        try {
            const instance = axios.create({
                baseURL: url,
                responseType: 'stream',
            });
        
            const response = await instance.post(endpoint, payload);
            const responseData = response.data;
        
            const incomingMessage = Array.isArray(responseData) && responseData.length > 0 ? responseData[0] : responseData;
        
            let eventCount = 0;
        
            incomingMessage.on('data', data => {
                const events = data.toString().split('\n');
        
                events.forEach(event => {
                    eventCount++;
        
                    if (event.trim() === '') return;

                    if (event.trim() === 'data: [DONE]') {
                        t.truthy(eventCount > 1);
                        resolve();
                        return;
                    }
        
                    const message = event.replace(/^data: /, '');
                    const messageJson = JSON.parse(message);
                    
                    customAssertions(t, messageJson);
                });
            });  
        
        } catch (error) {
            console.error('Error connecting to SSE endpoint:', error);
            reject(error);
        }
    });
}

test('POST SSE: /v1/completions should send a series of events and a [DONE] event', async (t) => {
    const payload = {
        model: 'gpt-3.5-turbo',
        prompt: 'Word to your motha!',
        stream: true,
    };
    
    const url = `http://localhost:${process.env.CORTEX_PORT}/v1`;
    
    const completionsAssertions = (t, messageJson) => {
        t.truthy(messageJson.id);
        t.is(messageJson.object, 'text_completion');
        t.truthy(messageJson.choices[0].finish_reason === null || messageJson.choices[0].finish_reason === 'stop');
    };
    
    await connectToSSEEndpoint(url, '/completions', payload, t, completionsAssertions);
});

test('POST SSE: /v1/chat/completions should send a series of events and a [DONE] event', async (t) => {
    const payload = {
        model: 'gpt-4o',
        messages: [
        {
            role: 'user',
            content: 'Hello!',
        },
        ],
        stream: true,
    };
    
    const url = `http://localhost:${process.env.CORTEX_PORT}/v1`;
    
    const chatCompletionsAssertions = (t, messageJson) => {
        t.truthy(messageJson.id);
        t.is(messageJson.object, 'chat.completion.chunk');
        t.truthy(messageJson.choices[0].delta);
        t.truthy(messageJson.choices[0].finish_reason === null || messageJson.choices[0].finish_reason === 'stop');
    };
    
    await connectToSSEEndpoint(url, '/chat/completions', payload, t, chatCompletionsAssertions);
});

test('POST SSE: /v1/chat/completions with multimodal content should send a series of events and a [DONE] event', async (t) => {
    const payload = {
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'What do you see in this image?'
            },
            {
              type: 'image',
              image_url: {
                url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABQODxIPDRQSEBIXFRQdHx4eHRoaHSQrJyEwPENBMDQ4NDQ0QUJCSkNLS0tNSkpQUFFQR1BTYWNgY2FQYWFQYWj/2wBDARUXFyAeIBohHh4oIiE2LCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='
              }
            }
          ]
        }],
        stream: true,
    };
    
    const url = `http://localhost:${process.env.CORTEX_PORT}/v1`;
    
    const multimodalChatCompletionsAssertions = (t, messageJson) => {
        t.truthy(messageJson.id);
        t.is(messageJson.object, 'chat.completion.chunk');
        t.truthy(messageJson.choices[0].delta);
        if (messageJson.choices[0].finish_reason === 'stop') {
          t.truthy(messageJson.choices[0].delta);
        }
    };
    
    await connectToSSEEndpoint(url, '/chat/completions', payload, t, multimodalChatCompletionsAssertions);
});  

test('POST /chat/completions should handle multimodal content for non-multimodal model', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What do you see in this image?'
          },
          {
            type: 'image',
            image_url: {
              url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...'
            }
          }
        ]
      }],
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
  t.truthy(response.body.choices[0].message.content);
});

test('POST SSE: /v1/chat/completions should handle streaming multimodal content for non-multimodal model', async (t) => {
  const payload = {
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'What do you see in this image?'
        },
        {
          type: 'image',
          image_url: {
            url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...'
          }
        }
      ]
    }],
    stream: true,
  };

  const streamingAssertions = (t, messageJson) => {
    t.truthy(messageJson.id);
    t.is(messageJson.object, 'chat.completion.chunk');
    t.truthy(messageJson.choices[0].delta);
    if (messageJson.choices[0].finish_reason === 'stop') {
      t.truthy(messageJson.choices[0].delta);
    }
  };

  await connectToSSEEndpoint(
    `http://localhost:${process.env.CORTEX_PORT}/v1`,
    '/chat/completions',
    payload,
    t,
    streamingAssertions
  );
});

test('POST /chat/completions should handle malformed multimodal content', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            // Missing text field
          },
          {
            type: 'image',
            // Missing image_url
          }
        ]
      }],
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
  t.truthy(response.body.choices[0].message.content);
});

test('POST /chat/completions should handle invalid image data', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What do you see in this image?'
          },
          {
            type: 'image',
            image_url: {
              url: 'not-a-valid-base64-image'
            }
          }
        ]
      }],
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
  t.truthy(response.body.choices[0].message.content);
});  

test('POST /completions should handle model parameters', async (t) => {
  const response = await got.post(`${API_BASE}/completions`, {
    json: {
      model: 'gpt-3.5-turbo',
      prompt: 'Say this is a test',
      temperature: 0.7,
      max_tokens: 100,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'text_completion');
  t.true(Array.isArray(response.body.choices));
  t.truthy(response.body.choices[0].text);
});

test('POST /chat/completions should handle function calling', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'What is the weather in Boston?' }],
      functions: [{
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA'
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit']
            }
          },
          required: ['location']
        }
      }],
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
  const choice = response.body.choices[0];
  t.true(['function_call', 'stop'].includes(choice.finish_reason));
  if (choice.finish_reason === 'function_call') {
    t.truthy(choice.message.function_call);
    t.truthy(choice.message.function_call.name);
    t.truthy(choice.message.function_call.arguments);
  }
});

test('POST /chat/completions should validate response format', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello!' }],
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
  t.truthy(response.body.id);
  t.truthy(response.body.created);
  t.truthy(response.body.model);
  
  const choice = response.body.choices[0];
  t.is(typeof choice.index, 'number');
  t.truthy(choice.message);
  t.truthy(choice.message.role);
  t.truthy(choice.message.content);
  t.truthy(choice.finish_reason);
});

test('POST /chat/completions should handle system messages', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' }
      ],
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
  t.truthy(response.body.choices[0].message.content);
});

test('POST /chat/completions should handle errors gracefully', async (t) => {
  const error = await t.throwsAsync(
    () => got.post(`${API_BASE}/chat/completions`, {
      json: {
        // Missing required model field
        messages: [{ role: 'user', content: 'Hello!' }],
      },
      responseType: 'json',
    })
  );
  
  t.is(error.response.statusCode, 404);
});

test('POST /chat/completions should handle token limits', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [{ 
        role: 'user', 
        content: 'Hello!'.repeat(5000) // Very long message
      }],
      max_tokens: 100,
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
  t.truthy(response.body.choices[0].message.content);
});  

test('POST /chat/completions should return complete responses from gpt-4o', async (t) => {
  const response = await got.post(`${API_BASE}/chat/completions`, {
    json: {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Always end your response with the exact string "END_MARKER_XYZ".' },
        { role: 'user', content: 'Say hello and explain why complete responses matter.' }
      ],
      stream: false,
    },
    responseType: 'json',
  });

  t.is(response.statusCode, 200);
  t.is(response.body.object, 'chat.completion');
  t.true(Array.isArray(response.body.choices));
  console.log('GPT-4o Response:', JSON.stringify(response.body.choices[0].message.content));
  const content = response.body.choices[0].message.content;
  t.regex(content, /END_MARKER_XYZ$/);
}); 
  
