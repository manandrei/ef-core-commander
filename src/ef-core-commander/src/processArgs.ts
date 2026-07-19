export function splitArguments(command: string): string[] {
  const args: string[] = [];
  const regex = /"((?:\\"|[^"])*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    args.push((match[1] || match[2]).replace(/\\"/g, "\""));
  }
  return args;
}
