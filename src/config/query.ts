import { gql } from 'graphql-request';
import { Address } from 'viem';

export interface GRAPH_POSITIONS_RESPONSE {
  id: string;
  owner: Address;
  tokenId: bigint;
}

export const GET_POSITIONS_QUERY = gql`
  query GetPositions($owner: String!) {
    positions(where: { owner: $owner }) {
      tokenId
      owner
      id
    }
  }
`;
