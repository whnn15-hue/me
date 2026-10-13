/** Keep legacy stored values intact while using plain punctuation in the UI. */
export const displayText = (value: string) => value.replaceAll("\u00b7", ", ");
