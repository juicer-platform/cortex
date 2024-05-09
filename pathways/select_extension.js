// Description: Have a chat with a bot that uses context to understand the conversation
export default {
    prompt: `User text: {{text}}\n\n Your Instructions: Analyze user text and extract all the following information. Decide to route messages to a knowledge base expert system when the user needs some information or documents or articles, or if user asks question that require specific knowledge, or if some extra knowledge can help you reply better; also anything related to news, articles, geopolitical entities, or current events should be forwarded as those can be found in the expert system. The expert system should not be consulted if the users message is just conversational. You will reply this in field useExpertSystem with true or false. Also in the text, the user may or may not have requested one of the following services:\n{"services": ["Coding", "Translate", "Transcribe", "Summary", "Headlines", "Entities", "Spelling", "Grammar", "Style", "Entities", "Newswires", "FileOrDocumentUpload"]}\nSelect the services the user requested (or none if none were requested) and return them as a JSON object field called "services". Also return the user text's language in language field in ISO 639-3 format. You will reply with the single valid JSON object (no other text or commentary) that must include JSON fields: useExpertSystem, services, language.\n\n`,
    // model: 'azure-turbo',
    model: 'azure-gpt4',
    useInputChunking: false,
}