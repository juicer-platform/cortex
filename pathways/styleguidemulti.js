const input = `
Input: {{ text }}

Output:`;

module.exports = {
    temperature: 0,
    prompt: [`Correct all spelling and grammar errors. ${input}`,
        `Don't use the % sign - spell out percent instead. ${input}`,
        `Unless using a full official title, use lower case. ${input}`,
        `Expand all abbreviated month names. ${input}`,
        `Expand monetary abbreviations. ${input}`,
        `Change all words to British English spelling regardless of where they occur. ${input}`
    ],
    chunk: true
}