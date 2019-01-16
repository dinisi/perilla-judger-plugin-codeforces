declare module "socks-proxy-agent" {
    import { Agent } from 'https';
    import { Url } from 'url';

    class SocksProxyAgent extends Agent {
        constructor(options: string | Url);
    }

    export = SocksProxyAgent;
}