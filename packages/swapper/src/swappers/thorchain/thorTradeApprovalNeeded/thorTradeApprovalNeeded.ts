import { fromAssetId, fromChainId, getFeeAssetIdFromAssetId } from '@shapeshiftoss/caip'

import { ApprovalNeededInput, ApprovalNeededOutput } from '../../../api'
import { SwapError, SwapErrorTypes } from '../../../api'
import { erc20AllowanceAbi } from '../../utils/abi/erc20Allowance-abi'
import { bnOrZero } from '../../utils/bignumber'
import { getERC20Allowance } from '../../utils/helpers/helpers'
import { ThorchainSwapperDeps } from '../types'

export const thorTradeApprovalNeeded = async ({
  deps,
  input
}: {
  deps: ThorchainSwapperDeps
  input: ApprovalNeededInput<'eip155:1'>
}): Promise<ApprovalNeededOutput> => {
  try {
    const { quote, wallet } = input
    const { sellAsset } = quote
    const { adapterManager, web3 } = deps

    const { assetReference: sellAssetErc20Address } = fromAssetId(sellAsset.assetId)
    const { chainNamespace } = fromChainId(sellAsset.chainId)

    if (chainNamespace !== 'eip155') {
      throw new SwapError(
        '[thorTradeApprovalNeeded] - sellAsset chain namespace is not supported',
        {
          code: SwapErrorTypes.UNSUPPORTED_CHAIN,
          details: { chainNamespace }
        }
      )
    }

    // No approval needed for selling a fee asset
    if (sellAsset.assetId === getFeeAssetIdFromAssetId(sellAsset.assetId)) {
      return { approvalNeeded: false }
    }

    const accountNumber = quote.sellAssetAccountNumber

    const adapter = adapterManager.get(sellAsset.chainId)

    if (!adapter)
      throw new SwapError(
        `[thorTradeApprovalNeeded] - no chain adapter found for chain Id: ${sellAsset.chainId}`,
        {
          code: SwapErrorTypes.UNSUPPORTED_CHAIN,
          details: { chainId: sellAsset.chainId }
        }
      )

    const bip44Params = adapter.buildBIP44Params({ accountNumber })
    const receiveAddress = await adapter.getAddress({ wallet, bip44Params })

    if (!quote.allowanceContract) {
      throw new SwapError('[thorTradeApprovalNeeded] - allowanceTarget is required', {
        code: SwapErrorTypes.VALIDATION_FAILED,
        details: { chainId: sellAsset.chainId }
      })
    }

    const allowanceResult = await getERC20Allowance({
      web3,
      erc20AllowanceAbi,
      sellAssetErc20Address,
      spenderAddress: quote.allowanceContract,
      ownerAddress: receiveAddress
    })
    const allowanceOnChain = bnOrZero(allowanceResult)

    if (!quote.feeData.chainSpecific?.gasPrice)
      throw new SwapError('[thorTradeApprovalNeeded] - no gas price with quote', {
        code: SwapErrorTypes.RESPONSE_ERROR,
        details: { feeData: quote.feeData }
      })
    return {
      approvalNeeded: allowanceOnChain.lte(bnOrZero(quote.sellAmount))
    }
  } catch (e) {
    if (e instanceof SwapError) throw e
    throw new SwapError('[thorTradeApprovalNeeded]', {
      cause: e,
      code: SwapErrorTypes.CHECK_APPROVAL_FAILED
    })
  }
}
