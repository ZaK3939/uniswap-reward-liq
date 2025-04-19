import { Chain } from 'viem';

export const unichain: Chain = {
  id: 130, // UnichainのチェーンID
  name: 'Unichain',
  network: 'unichain',
  nativeCurrency: {
    decimals: 18,
    name: 'Unichain Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['https://unichain-rpc.publicnode.com'], // 実際のRPC URLに置き換える
    },
    public: {
      http: ['https://unichain-rpc.publicnode.com'], // 実際のRPC URLに置き換える
    },
  },
  blockExplorers: {
    default: {
      name: 'UnichainScan',
      url: 'https://uniscan.xyz', // 実際のブロックエクスプローラURLに置き換える
    },
  },
};
