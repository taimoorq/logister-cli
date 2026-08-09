const ANSI_SEQUENCE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const C1_CSI_SEQUENCE = /\u009B[0-?]*[ -/]*[@-~]/g;
const C1_OSC_SEQUENCE = /\u009D[^\u0007\u009C]*(?:\u0007|\u009C)/g;
const NON_PRINTING_TERMINAL_CONTROL = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const MACHINE_UNSAFE_CONTROL = /[\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeTerminalText(value, { preserveNewlines = false } = {}) {
  let text = String(value)
    .replace(ANSI_SEQUENCE, "")
    .replace(C1_OSC_SEQUENCE, "")
    .replace(C1_CSI_SEQUENCE, "");
  text = text.replace(/\r\n|\r/g, "\n");
  text = text.replace(NON_PRINTING_TERMINAL_CONTROL, "");
  return preserveNewlines ? text : text.replace(/\n/g, " ");
}

export function stringifyMachineSafe(value, space) {
  return JSON.stringify(value, null, space).replace(MACHINE_UNSAFE_CONTROL, (character) => {
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}
