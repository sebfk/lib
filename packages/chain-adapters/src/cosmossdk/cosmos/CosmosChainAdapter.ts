import { CAIP2, WellKnownChain } from '@shapeshiftoss/caip'
import {
  bip32ToAddressNList,
  CosmosSignTx,
  CosmosTx,
  supportsCosmos
} from '@shapeshiftoss/hdwallet-core'
import { BIP44Params, chainAdapters, ChainAdapterType } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'
import BigNumber from 'bignumber.js'

import { ChainAdapter as IChainAdapter } from '../../api'
import { ErrorHandler } from '../../error/ErrorHandler'
import { toPath } from '../../utils'
import { ChainAdapterArgs, CosmosSdkBaseAdapter } from '../CosmosSdkBaseAdapter'

export class ChainAdapter
  extends CosmosSdkBaseAdapter<ChainAdapterType.Cosmos>
  implements IChainAdapter<ChainAdapterType.Cosmos>
{
  protected static readonly supportedChainIds: CAIP2[] = [
    WellKnownChain.CosmosHubMainnet,
    WellKnownChain.CosmosHubVega
  ]
  public static readonly defaultBIP44Params: BIP44Params = {
    purpose: 44,
    coinType: 118,
    accountNumber: 0
  }

  constructor(args: ChainAdapterArgs) {
    super(ChainAdapter.supportedChainIds, args)
    this.parser = new unchained.cosmos.TransactionParser({ chainId: this.chainId })
  }

  getType(): ChainAdapterType.Cosmos {
    return ChainAdapterType.Cosmos
  }

  async getAddress(input: chainAdapters.GetAddressInput): Promise<string> {
    const { wallet, bip44Params = ChainAdapter.defaultBIP44Params } = input
    const path = toPath(bip44Params)
    const addressNList = bip32ToAddressNList(path)

    try {
      if (supportsCosmos(wallet)) {
        const cosmosAddress = await wallet.cosmosGetAddress({
          addressNList,
          showDisplay: Boolean(input.showOnDevice)
        })
        if (!cosmosAddress) {
          throw new Error('Unable to generate Cosmos address.')
        }
        return cosmosAddress
      } else {
        throw new Error('Wallet does not support Cosmos.')
      }
    } catch (error) {
      return ErrorHandler(error)
    }
  }

  async signTransaction(signTxInput: chainAdapters.SignTxInput<CosmosSignTx>): Promise<string> {
    try {
      const { txToSign, wallet } = signTxInput
      if (supportsCosmos(wallet)) {
        const signedTx = await wallet.cosmosSignTx(txToSign)

        if (!signedTx) throw new Error('Error signing tx')

        return signedTx.serialized
      } else {
        throw new Error('Wallet does not support Cosmos.')
      }
    } catch (err) {
      return ErrorHandler(err)
    }
  }

  async buildSendTransaction(
    tx: chainAdapters.BuildSendTxInput<ChainAdapterType.Cosmos>
  ): Promise<{ txToSign: CosmosSignTx }> {
    try {
      const {
        to,
        wallet,
        bip44Params = CosmosSdkBaseAdapter.defaultBIP44Params,
        chainSpecific: { gas },
        sendMax = false,
        value
      } = tx

      if (!to) throw new Error('CosmosChainAdapter: to is required')
      if (!value) throw new Error('CosmosChainAdapter: value is required')

      const path = toPath(bip44Params)
      const addressNList = bip32ToAddressNList(path)
      const from = await this.getAddress({ bip44Params, wallet })

      if (sendMax) {
        const account = await this.getAccount(from)
        tx.value = new BigNumber(account.balance).minus(gas).toString()
      }

      const utx: CosmosTx = {
        fee: {
          amount: [
            {
              amount: new BigNumber(gas).toString(),
              denom: 'uatom'
            }
          ],
          gas: gas
        },
        msg: [
          {
            type: 'cosmos-sdk/MsgSend',
            value: {
              amount: [
                {
                  amount: new BigNumber(value).toString(),
                  denom: 'uatom'
                }
              ],
              from_address: from,
              to_address: to
            }
          }
        ],
        signatures: [],
        memo: ''
      }

      const txToSign: CosmosSignTx = {
        addressNList,
        tx: utx,
        chain_id: this.chainId.split(':')[1],
        account_number: '',
        sequence: ''
      }
      return { txToSign }
    } catch (err) {
      return ErrorHandler(err)
    }
  }

  async getFeeData(
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars -- Disable no-unused-vars lint rule for unimplemented methods */
    input: Partial<chainAdapters.GetFeeDataInput<ChainAdapterType.Cosmos>>
  ): Promise<chainAdapters.FeeDataEstimate<ChainAdapterType.Cosmos>> {
    throw new Error('Method not implemented.')
  }

  async signAndBroadcastTransaction(
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars -- Disable no-unused-vars lint rule for unimplemented methods */
    signTxInput: chainAdapters.SignTxInput<CosmosSignTx>
  ): Promise<string> {
    throw new Error('Method not implemented.')
  }
}
