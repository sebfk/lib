import BigNumber from 'bignumber.js'
import { AxiosResponse } from 'axios'
import * as rax from 'retry-axios'
import { ChainAdapter, ChainIdentifier } from '@shapeshiftoss/chain-adapters'
import { Quote, SwapError, BuildQuoteTxArgs } from '../../..'
import { ZrxSwapperDeps } from '../ZrxSwapper'
import { applyAxiosRetry } from '../utils/applyAxiosRetry'
import { erc20AllowanceAbi } from '../utils/abi/erc20-abi'
import { normalizeAmount, getAllowanceRequired } from '../utils/helpers/helpers'
import { zrxService } from '../utils/zrxService'
import {
  DEFAULT_SLIPPAGE,
  DEFAULT_SOURCE,
  DEFAULT_ETH_PATH,
  AFFILIATE_ADDRESS,
  APPROVAL_GAS_LIMIT
} from '../utils/constants'

type LiquiditySource = {
  name: string
  proportion: string
}

type QuoteResponse = {
  price: string
  guaranteedPrice: string
  to: string
  data?: string
  value?: string
  gas?: string
  estimatedGas?: string
  gasPrice?: string
  protocolFee?: string
  minimumProtocolFee?: string
  buyTokenAddress?: string
  sellTokenAddress?: string
  buyAmount?: string
  sellAmount?: string
  allowanceTarget?: string
  sources?: Array<LiquiditySource>
}

export async function buildQuoteTx(
  { adapterManager, web3 }: ZrxSwapperDeps,
  { input, wallet }: BuildQuoteTxArgs
): Promise<Quote> {
  const {
    sellAsset,
    buyAsset,
    sellAmount,
    buyAmount,
    slippage,
    sellAssetAccountId,
    buyAssetAccountId,
    priceImpact
  } = input

  if ((buyAmount && sellAmount) || (!buyAmount && !sellAmount)) {
    throw new SwapError(
      'ZrxSwapper:buildQuoteTx Exactly one of buyAmount or sellAmount is required'
    )
  }

  if (!sellAssetAccountId || !buyAssetAccountId) {
    throw new SwapError(
      'ZrxSwapper:buildQuoteTx Both sellAssetAccountId and buyAssetAccountId are required'
    )
  }

  const buyToken = buyAsset.tokenId || buyAsset.symbol || buyAsset.network
  const sellToken = sellAsset.tokenId || sellAsset.symbol || sellAsset.network
  if (!buyToken) {
    throw new SwapError(
      'ZrxSwapper:buildQuoteTx One of buyAssetContract or buyAssetSymbol or buyAssetNetwork are required'
    )
  }
  if (!sellToken) {
    throw new SwapError(
      'ZrxSwapper:buildQuoteTx One of sellAssetContract or sellAssetSymbol or sellAssetNetwork are required'
    )
  }

  // TODO: (ryankk) Remove the type cast when we unify ChainIdentifier and ChainTypes
  const adapter: ChainAdapter = adapterManager.byChain(
    (buyAsset.chain as unknown) as ChainIdentifier
  )
  const receiveAddress = await adapter.getAddress({ wallet, path: DEFAULT_ETH_PATH })

  const slippagePercentage = slippage
    ? new BigNumber(slippage).div(100).toString()
    : DEFAULT_SLIPPAGE

  try {
    /**
     * /swap/v1/quote
     * params: {
     *   sellToken: contract address (or symbol) of token to sell
     *   buyToken: contractAddress (or symbol) of token to buy
     *   sellAmount?: integer string value of the smallest increment of the sell token
     *   buyAmount?: integer string value of the smallest incremtent of the buy token
     * }
     */

    const zrxRetry = applyAxiosRetry(zrxService, {
      statusCodesToRetry: [[400, 400]],
      shouldRetry: (err) => {
        const cfg = rax.getConfig(err)
        const retryAttempt = cfg?.currentRetryAttempt ?? 0
        const retry = cfg?.retry ?? 3
        // ensure max retries is always respected
        if (retryAttempt >= retry) return false
        // retry if 0x returns error code 111 Gas estimation failed
        if (err?.response?.data?.code === 111) return true

        // Handle the request based on your other config options, e.g. `statusCodesToRetry`
        return rax.shouldRetryRequest(err)
      }
    })
    const quoteResponse: AxiosResponse<QuoteResponse> = await zrxRetry.get<QuoteResponse>(
      '/swap/v1/quote',
      {
        params: {
          buyToken,
          sellToken,
          sellAmount: normalizeAmount(sellAmount?.toString()),
          buyAmount: normalizeAmount(buyAmount?.toString()),
          takerAddress: receiveAddress,
          slippagePercentage,
          skipValidation: false,
          affiliateAddress: AFFILIATE_ADDRESS
        }
      }
    )

    const { data } = quoteResponse

    const estimatedGas = new BigNumber(data.gas || 0)
    const quote: Quote = {
      sellAsset,
      buyAsset,
      sellAssetAccountId,
      buyAssetAccountId,
      receiveAddress,
      slippage,
      success: true,
      statusCode: 0,
      rate: data.price,
      depositAddress: data.to,
      feeData: {
        fee: new BigNumber(estimatedGas || 0)
          .multipliedBy(new BigNumber(data.gasPrice || 0))
          .toString(),
        estimatedGas: estimatedGas.toString(),
        gasPrice: data.gasPrice
      },
      txData: data.data,
      sellAmount: data.sellAmount,
      buyAmount: data.buyAmount,
      guaranteedPrice: data.guaranteedPrice,
      allowanceContract: data.allowanceTarget,
      sources: data.sources?.filter((s) => parseFloat(s.proportion) > 0) || DEFAULT_SOURCE,
      priceImpact
    }

    const allowanceRequired = await getAllowanceRequired({
      quote,
      web3,
      erc20AllowanceAbi
    })
    quote.allowanceGrantRequired = allowanceRequired.gt(0)
    if (quote.allowanceGrantRequired) {
      quote.feeData = {
        ...quote.feeData,
        approvalFee: new BigNumber(APPROVAL_GAS_LIMIT).multipliedBy(data.gasPrice || 0).toString()
      }
    }
    return quote
  } catch (e) {
    if (e.status === 400) {
      return {
        sellAsset,
        buyAsset,
        success: false,
        statusCode: e.body?.code || -1,
        statusReason: e.body?.reason || 'Unknown Client Failure'
      }
    } else if (e.status === 500) {
      // TODO: Handle error
    }

    throw new SwapError(`ZrxSwapper:buildQuoteTx Error getting quote: ${e}`)
  }
}
