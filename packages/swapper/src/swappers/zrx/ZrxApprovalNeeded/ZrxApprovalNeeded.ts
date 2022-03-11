import { AssetNamespace, caip19, WellKnownChain } from '@shapeshiftoss/caip'
import {
  ApprovalNeededInput,
  ApprovalNeededOutput,
  ChainAdapterType,
  QuoteResponse,
  SwapperType
} from '@shapeshiftoss/types'
import { AxiosResponse } from 'axios'
import { BigNumber } from 'bignumber.js'

import { SwapError } from '../../../api'
import { erc20AllowanceAbi } from '../utils/abi/erc20Allowance-abi'
import {
  AFFILIATE_ADDRESS,
  APPROVAL_BUY_AMOUNT,
  APPROVAL_GAS_LIMIT,
  DEFAULT_SLIPPAGE
} from '../utils/constants'
import { getERC20Allowance, getZrxToken } from '../utils/helpers/helpers'
import { zrxService } from '../utils/zrxService'
import { ZrxSwapperDeps } from '../ZrxSwapper'

export async function ZrxApprovalNeeded(
  { adapterManager, web3 }: ZrxSwapperDeps,
  { quote, wallet }: ApprovalNeededInput<ChainAdapterType, SwapperType>
): Promise<ApprovalNeededOutput> {
  const { sellAsset } = quote

  if (sellAsset.symbol === 'ETH') {
    return { approvalNeeded: false }
  }

  const { chainId: sellAssetChainId } = caip19.fromCAIP19(sellAsset.assetId)
  if (sellAssetChainId !== WellKnownChain.EthereumMainnet) {
    throw new SwapError('ZrxSwapper:ZrxApprovalNeeded only Ethereum chain type is supported')
  }

  const accountNumber = quote.sellAssetAccountId ? Number(quote.sellAssetAccountId) : 0

  const adapter = await adapterManager.byChainId(sellAssetChainId)
  const bip44Params = adapter.buildBIP44Params({ accountNumber })
  const receiveAddress = await adapter.getAddress({ wallet, bip44Params })

  /**
   * /swap/v1/quote
   * params: {
   *   sellToken: contract address (or symbol) of token to sell
   *   buyToken: contractAddress (or symbol) of token to buy
   *   sellAmount?: integer string value of the smallest increment of the sell token
   *   buyAmount?: integer string value of the smallest incremtent of the buy token
   * }
   */
  const quoteResponse: AxiosResponse<QuoteResponse> = await zrxService.get<QuoteResponse>(
    '/swap/v1/quote',
    {
      params: {
        buyToken: 'ETH',
        sellToken: getZrxToken(quote.sellAsset),
        buyAmount: APPROVAL_BUY_AMOUNT,
        takerAddress: receiveAddress,
        slippagePercentage: DEFAULT_SLIPPAGE,
        skipValidation: true,
        affiliateAddress: AFFILIATE_ADDRESS
      }
    }
  )
  const { data } = quoteResponse

  if (!data.allowanceTarget) {
    throw new SwapError('ZrxApprovalNeeded - allowanceTarget is required')
  }
  const { assetNamespace, assetReference } = caip19.fromCAIP19(quote.sellAsset.assetId)
  if (assetNamespace !== AssetNamespace.ERC20) {
    throw new SwapError('ZrxApprovalNeeded - asset must be an ERC20')
  }
  const allowanceResult = await getERC20Allowance({
    web3,
    erc20AllowanceAbi,
    tokenId: assetReference,
    spenderAddress: data.allowanceTarget,
    ownerAddress: receiveAddress
  })
  const allowanceOnChain = new BigNumber(allowanceResult || '0')

  return {
    approvalNeeded: allowanceOnChain.lt(new BigNumber(quote.sellAmount || 1)),
    gas: APPROVAL_GAS_LIMIT,
    gasPrice: data.gasPrice
  }
}
