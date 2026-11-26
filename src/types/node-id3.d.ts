declare module 'node-id3' {
  export interface Tags {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    publisher?: string;
    comment?: { language?: string; text?: string };
    userDefinedText?: Array<{ description: string; value: string }>;
  }

  export function write(tags: Tags, buffer: Buffer): Buffer | Error | boolean;
}
