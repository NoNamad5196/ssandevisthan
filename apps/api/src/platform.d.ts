// Only the retained, unreachable Deno fallback needs these declarations in the
// Node compilation. Its real platform implementation is checked by `deno check`.
declare namespace Deno {
  interface Conn {remoteAddr:{transport:string;hostname:string};close():void;read(buffer:Uint8Array):Promise<number|null>;write(buffer:Uint8Array):Promise<number>}
  interface TcpConn extends Conn {}
  interface TlsConn extends Conn {}
  const env:{get(name:string):string|undefined};
  function connect(options:{hostname:string;port:number;transport:string}):Promise<TcpConn>;
  function startTls(conn:TcpConn,options:{hostname:string;alpnProtocols:string[]}):Promise<TlsConn>;
  function resolveDns(host:string,type:'A'|'AAAA'):Promise<string[]>;
  function readFile(path:string):Promise<Uint8Array>;
  function serve(handler:(req:Request)=>Response|Promise<Response>):unknown;
}
interface ImportMeta {readonly main?:boolean}
declare const EdgeRuntime:{waitUntil(promise:Promise<unknown>):void};
