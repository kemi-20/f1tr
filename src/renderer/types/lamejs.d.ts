declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number)
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array
    flush(): Int8Array
  }
  export class WavHeader {
    static createHeader(dataLength: number, channels: number, sampleRate: number, bitsPerSample: number): ArrayBuffer
    static extendData(buf: ArrayBuffer, dataLength: number, channels: number, bitsPerSample: number): ArrayBuffer
  }
}
