import {Socket} from "socket.io";
import {createId} from "@paralleldrive/cuid2";
import type {InterServerEvents, SocketData} from "./SocketServer";
import type {RealtimeVoiceClient} from "./realtime/client";
import type {ClientToServerEvents, ServerToClientEvents} from "./realtime/socket";
import {search} from "./cortex/search";
import {expert} from "./cortex/expert";
import {image} from "./cortex/image";
import {vision, type MultiMessage} from "./cortex/vision";
import {reason} from "./cortex/reason";
import { logger } from './utils/logger';
import { searchMemory } from "./cortex/memory";
import { MemorySection, type ChatMessage } from "./cortex/utils";
import type {SocketServer} from "./SocketServer";

interface ScreenshotArgs {
  lastUserMessage: string;
  silent?: boolean;
}

interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

interface TextContent {
  type: 'text';
  text: string;
}

interface ImageMessage {
  role: string;
  content: (TextContent | ImageContent)[];
}

export class Tools {
  private realtimeClient: RealtimeVoiceClient;
  private socket: Socket<ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData>;
  private socketServer: SocketServer;

  constructor(client: RealtimeVoiceClient,
              socket: Socket<ClientToServerEvents,
                ServerToClientEvents,
                InterServerEvents,
                SocketData>,
              socketServer: SocketServer) {
    this.realtimeClient = client;
    this.socket = socket;
    this.socketServer = socketServer;
  }

  private async sendPrompt(prompt: string, allowTools: boolean = false, disposable: boolean = true) {
    await this.socketServer.sendPrompt(this.realtimeClient, this.socket, prompt, allowTools, disposable);
  }

  public static getToolDefinitions() {
    return [
      {
        type: 'function',
        name: 'MemoryLookup',
        description: 'Use this tool to proactively search your memories for information that might be relevant to the conversation. It\'s critical to maintain natural conversation flow with the user, so stall them for a few seconds with natural banter while you use this tool. Don\'t talk directly about the tool - just say "let me think about that" or something else that fits the conversation.',
        parameters: {
          type: "object",
          properties: {
            lastUserMessage: {type: "string"},
          },
          required: ["lastUserMessage"]
        },
      },
      {
        type: 'function',
        name: 'Search',
        description: 'Use for current events, news, fact-checking, and information requiring citation. This tool allows you to search the internet, all Al Jazeera news articles and the latest news wires from multiple sources. You pass in detailed instructions about what you need the tool to do in detailedInstructions.',
        parameters: {
          type: "object",
          properties: {
            detailedInstructions: {type: "string"},
          },
          required: ["detailedInstructions"]
        },
      },
      {
        type: 'function',
        name: 'Document',
        description: 'Access user\'s personal document index. Use for user-specific uploaded information. If user refers vaguely to "this document/file/article" without context, search the personal index. You pass in detailed instructions about what you need the tool to do in detailedInstructions.',
        parameters: {
          type: "object",
          properties: {
            detailedInstructions: {type: "string"},
          },
          required: ["detailedInstructions"]
        },
      },
      {
        type: 'function',
        name: 'Write',
        description: 'Engage for any task related to composing, editing, or refining written content. This includes articles, essays, scripts, or any form of textual creation or modification. If you need to search for information or look at a document first, use the Search or Document tools. This tool is just to create or modify content. You pass in detailed instructions about what you need the tool to do in detailedInstructions.',
        parameters: {
          type: "object",
          properties: {
            detailedInstructions: {type: "string"},
          },
          required: ["detailedInstructions"]
        },
      },
      {
        type: 'function',
        name: 'Image',
        description: 'Use this tool when asked to create, generate, or revise visual content including selfies, photographs, illustrations, diagrams, or any other type of image. You pass in detailed instructions about the image(s) you want to create in detailedInstructions. This tool only creates images - it cannot manipulate images (e.g. it cannot crop, rotate, or resize an existing image) - for those tasks you will need to use the CodeExecution tool.',
        parameters: {
          type: "object",
          properties: {
            detailedInstructions: {type: "string"},
          },
          required: ["detailedInstructions"]
        },
      },
      {
        type: 'function',
        name: 'Reason',
        description: 'Use this tool any time you need to think carefully about something or solve a problem. Use it to solve all math problems, logic problems, scientific analysis, evaluating evidence, strategic planning, problem-solving, logic puzzles, mathematical calculations, or any questions that require careful thought or complex choices. Also use when deep, step-by-step reasoning is required. You pass in detailed instructions about what you need the tool to do in detailedInstructions.',
        parameters: {
          type: "object",
          properties: {
            detailedInstructions: {type: "string"},
          },
          required: ["detailedInstructions"]
        },
      },
      {
        type: 'function',
        name: 'MuteAudio',
        description: 'Use this tool to enable or disable audio output (your voice) to the user. If you want to be quiet or the user has asked you to be quiet, use this tool with the argument mute="true". If you are muted and absolutely need to talk, use this tool with the argument mute="false".',
        parameters: {
          type: "object",
          properties: {
            mute: {type: "boolean"},
          },
          required: ["mute"]
        },
      },
      {
        type: 'function',
        name: 'Screenshot',
        description: 'Use this tool to capture a screenshot of what the user is currently seeing in their browser window or on their computer screen. Any time the user asks you to take a look at something on their computer screen, use this tool. The tool will request a screenshot from the client and send the image data and the conversation history to your visual processing core for a detailed analysis and response.',
        parameters: {
          type: "object",
          properties: {
            lastUserMessage: {type: "string"},
          },
          required: ["lastUserMessage"]
        },
      },
      // {
      //   type: 'function',
      //   name: 'Code',
      //   description: 'Engage for any programming-related tasks, including creating, modifying, reviewing, or explaining code. Use for general coding discussions or when specific programming expertise is needed.',
      //   parameters: {
      //     type: "object",
      //     properties: {
      //       codingPrompt: {type: "string"}
      //     },
      //     required: ["codingPrompt"]
      //   },
      // },
      // {
      //   type: 'function',
      //   name: 'CodeExecution',
      //   description: 'Use when explicitly asked to run or execute code, or when a coding agent is needed to perform specific tasks that require code execution like data analysis, data processing, image processing, or business intelligence tasks.',
      //   parameters: {
      //     type: "object",
      //     properties: {
      //       codeExecutionPrompt: {type: "string"}
      //     },
      //     required: ["codeExecutionPrompt"]
      //   },
      // },
      // {
      //   type: 'function',
      //   name: 'PDF',
      //   description: 'Use specifically for processing and answering questions about PDF file content.',
      //   parameters: {
      //     type: "object",
      //     properties: {
      //       query: {type: "string"}
      //     },
      //     required: ["query"]
      //   },
      // },
      // {
      //   type: 'function',
      //   name: 'Vision',
      //   description: 'Engage for analyzing and responding to queries about image files (jpg, gif, bmp, png, etc).',
      //   parameters: {
      //     type: "object",
      //     properties: {
      //       query: {type: "string"}
      //     },
      //     required: ["query"]
      //   },
      // },
      // {
      //   type: 'function',
      //   name: 'Video',
      //   description: 'Use for processing and answering questions about video or audio file content.',
      //   parameters: {
      //     type: "object",
      //     properties: {
      //       query: {type: "string"}
      //     },
      //     required: ["query"]
      //   },
      // }
    ];
  }

  async executeCall(call_id: string, name: string, args: string, contextId: string, aiName: string, isInteractive: boolean = true) {
    logger.log('Executing call', name, 'with args', args);

    let fillerIndex = 0;
    let timeoutId: NodeJS.Timer | undefined;
    let promptOnIdle = true;
    let promptOnCompletion = true;

    let parsedArgs;
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      // Ignore JSON parse errors
    }

    let isSilent = !isInteractive;

    const calculateFillerTimeout = (fillerIndex: number) => {
      const baseTimeout = 3500;
      const randomTimeout = Math.floor(Math.random() * Math.min((fillerIndex + 1) * 1000, 5000));
      return baseTimeout + randomTimeout;
    }

    const sendFillerMessage = async () => {
      logger.log('Tool execution: Sending filler message');
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      // Filler messages are disposable - skip if busy
      await this.sendPrompt(`You are currently using the ${name} tool to help with the user's request and several seconds have passed since your last voice response. You should respond to the user via audio with a brief vocal utterance e.g. \"hmmm\" or \"let's see\" that will let them know you're still there. Make sure to sound natural and human and fit the tone of the conversation. Keep it very brief.`, false, true);

      fillerIndex++;
      // Set next timeout with random interval
      timeoutId = setTimeout(sendFillerMessage, calculateFillerTimeout(fillerIndex));
    }

    let initialPrompt = `You are currently using the ${name} tool to help with the user's request. If you haven't yet told the user via voice that you're doing something, do so now. Keep it very brief and make it fit the conversation naturally.`;

    // tool specific initializations
    switch (name.toLowerCase()) {
      case 'memorylookup':
        initialPrompt =`You are currently using the MemoryLookup tool to help yourself remember something. It will be a few seconds before you remember the information. Stall the user for a few seconds with natural banter while you use this tool. Don't talk directly about the tool - just say "let me think about that" or something else that fits the conversation.`;
        isSilent = false;
        promptOnCompletion = true;
        promptOnIdle = false;
        break;
      case 'muteaudio':
        isSilent = true;
        promptOnCompletion = false;
        promptOnIdle = false;
        break;
    }

    // Skip initial message if silent
    if (!isSilent) {
      logger.log('Tool execution: Sending initial prompt - ', initialPrompt);
      await this.sendPrompt(initialPrompt, false, true);
    }

    // Set up idle updates if not silent and idle messages are enabled
    if (!isSilent && promptOnIdle) {
      timeoutId = setTimeout(sendFillerMessage, calculateFillerTimeout(fillerIndex));
    }

    let finishPrompt =`You have finished using the ${name} tool to help with the user's request. If you didn't get the results you wanted, need more information, or have more steps in your process, you can call another tool right now. If you choose not to call another tool because you have everything you need, respond to the user via audio`;

    try {
      const cortexHistory = this.getCortexHistory(parsedArgs);
      //logger.log('Cortex history', cortexHistory);
      let response;
      const imageUrls = new Set<string>();
      // tool specific execution logic
      switch (name.toLowerCase()) {
        case 'search':
        case 'document':
          response = await search(
            contextId,
            aiName,
            cortexHistory,
            name === 'Search' ? ['aje', 'aja', 'bing', 'wires', 'mydata'] : ['mydata'],
            JSON.stringify({query: args})
          );
          finishPrompt += ' by reading the output of the tool to the user verbatim - make sure to read it in your signature voice and style and ensure the emotion in your voice is appropriate for the content'
          break;

        case 'memorylookup':
          response = await searchMemory(
            contextId,
            aiName,
            cortexHistory,
            MemorySection.memoryAll
          );
          break;

        case 'muteaudio':
          const parsedMuteArgs = JSON.parse(args);
          this.socketServer.setMuted(this.socket, parsedMuteArgs.mute);
          response = { result: `Audio ${parsedMuteArgs.mute ? 'muted' : 'unmuted'} successfully` };
          if (!parsedMuteArgs.mute) {
            finishPrompt = 'You have used the MuteAudio tool to unmute yourself and address the user. You may now respond to the user via audio. The user may have been idle for some time. So you might want to start with "you there?" or something similarly fitting.';
          }
          break;

        case 'write':
        case 'code':
          response = await expert(
            contextId,
            aiName,
            cortexHistory,
            JSON.stringify({query: args})
          );
          finishPrompt += ' by reading the output of the tool to the user verbatim'
          break;

        case 'image':
          finishPrompt = 'You have finished using the Image tool to help with the user\'s request. The image is being shown to the user right now. Please respond to the user via audio. Don\'t include the image URL in your response as it\'s already being shown to the user in your interface';

          response = await image(
            contextId,
            aiName,
            cortexHistory,
            JSON.stringify({query: args})
          );
          
          // Extract image URLs from markdown ![...](url), HTML <img src="url">, and standard markdown links [text](url)
          const markdownImagePattern = /!\[.*?\]\((.*?)\)/g;
          const htmlPattern = /<img.*?src=["'](.*?)["']/g;
          const markdownLinkPattern = /\[.*?\]\((.*?)\)/g;
          
          let match;
          
          // Find markdown image URLs
          while ((match = markdownImagePattern.exec(response.result)) !== null) {
            imageUrls.add(match[1]);
          }
          
          // Find HTML image URLs
          while ((match = htmlPattern.exec(response.result)) !== null) {
            imageUrls.add(match[1]);
          }
          
          // Find standard markdown link URLs
          while ((match = markdownLinkPattern.exec(response.result)) !== null) {
            const url = match[1];
            // Only add URLs that appear to be image files
            if (url.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
              imageUrls.add(url);
            }
          }
          break;

        case 'pdf':
        case 'vision':
        case 'video':
          response = await vision(
            contextId,
            aiName,
            cortexHistory,
            JSON.stringify({query: args})
          );
          break;

        case 'reason':
          response = await reason(
            contextId,
            aiName,
            cortexHistory,
            JSON.stringify({query: args})
          );
          finishPrompt += ' by reading the output of the tool to the user verbatim'
          break;

        case 'screenshot':
          const parsedScreenshotArgs = JSON.parse(args) as ScreenshotArgs;
          
          // Create a Promise that will resolve when we get the screenshot
          const screenshotPromise = new Promise((resolve, reject) => {
            let imageChunks: string[] = [];
            let timeoutId: NodeJS.Timer;

            const resetTimeout = () => {
              if (timeoutId) clearTimeout(timeoutId);
              timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error('Screenshot capture timed out'));
              }, 30000); // 30 second timeout
            };

            const cleanup = () => {
              this.socket.off('screenshotError', handleError);
              this.socket.off('screenshotChunk', handleChunk);
              this.socket.off('screenshotComplete', handleComplete);
              if (timeoutId) clearTimeout(timeoutId);
            };

            const handleChunk = (chunk: string, index: number) => {
              resetTimeout();
              imageChunks[index] = chunk;
              logger.log(`Received screenshot chunk ${index}`);
            };

            const handleComplete = async (totalChunks: number) => {
              try {
                resetTimeout();
                if (imageChunks.length !== totalChunks) {
                  throw new Error(`Missing chunks: expected ${totalChunks}, got ${imageChunks.length}`);
                }
                const completeImage = imageChunks.join('');
                
                // Add the screenshot to the cortex history as a user message with image
                const imageMessage: MultiMessage = {
                  role: 'user',
                  content: [
                    JSON.stringify({
                      type: 'text',
                      text: parsedScreenshotArgs.lastUserMessage || 'Please analyze this screenshot.'
                    }),
                    JSON.stringify({
                      type: 'image_url',
                      image_url: {
                        url: completeImage
                      }
                    })
                  ]
                };
                
                // Get current history and append the image message
                const baseHistory = this.getCortexHistory();
                const updatedHistory = [...baseHistory, imageMessage];
                
                // Send to vision for analysis
                const visionResponse = await vision(
                  contextId,
                  aiName,
                  updatedHistory,
                  JSON.stringify({query: parsedScreenshotArgs.lastUserMessage})
                );
                
                cleanup();
                resolve(visionResponse);
              } catch (error) {
                cleanup();
                reject(error);
              }
            };

            const handleError = (error: string) => {
              cleanup();
              reject(new Error(error));
            };

            // Set up event listeners
            this.socket.on('screenshotError', handleError);
            this.socket.on('screenshotChunk', handleChunk);
            this.socket.on('screenshotComplete', handleComplete);

            // Start timeout
            resetTimeout();

            // Request the screenshot
            logger.log('Requesting screenshot');
            this.socket.emit('requestScreenshot');
          });
          
          // Wait for the screenshot and analysis
          response = await screenshotPromise;
          break;

        default:
          logger.log('Unknown function call', name);
      }
      logger.log(response);

      // Clear timer before creating final output
      if (timeoutId) {
        clearTimeout(timeoutId);
        // This is to avoid voice run-on if we were using please wait...
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      this.realtimeClient.createConversationItem({
        id: createId(),
        type: 'function_call_output',
        call_id: call_id,
        output: response?.result || '',
      });

      finishPrompt += '.';
      if (promptOnCompletion && !isSilent) {
        logger.log('Tool execution: Sending finish prompt - ', finishPrompt);
        await this.sendPrompt(finishPrompt, true, false);
      }

      // Send image events after finish prompt if we collected any
      if (name.toLowerCase() === 'image' && imageUrls.size > 0) {
        imageUrls.forEach(url => {
          this.socket.emit('imageCreated', url);
        });
      }
    } catch (error) {
      // Make sure to clear timer if there's an error
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      throw error;
    }
  }

  public getCortexHistory(parsedArgs: any = {}) {
    const history = this.realtimeClient.getConversationItems()
      .filter((item) => {
        // Filter out system messages and messages starting with <INSTRUCTIONS>
        if (item.type !== "message" || item.role === "system") return false;
        const content = item.content && item.content[0] ? item.content[0].text || item.content[0].transcript || '' : '';
        return !content.trim().startsWith('<INSTRUCTIONS>');
      })
      .map((item) => {
        return {
          role: item.role || 'user',
          content: item.content && item.content[0] ? item.content[0].text || item.content[0].transcript || '' : ''
        }
      });

      // Add lastUserMessage or detailedInstructions if they were provided
      if (parsedArgs.lastUserMessage || parsedArgs.detailedInstructions) {
        history.push({
          role: 'user',
          content: parsedArgs.lastUserMessage || parsedArgs.detailedInstructions
        });
      }

    return history;
  }
}
