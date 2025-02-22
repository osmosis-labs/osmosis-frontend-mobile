import { CoinPretty, PricePretty, RatePretty } from "@keplr-wallet/unit";
import { AssetList, Chain } from "@osmosis-labs/types";
import { timeout } from "@osmosis-labs/utils";
import cachified, { CacheEntry } from "cachified";
import { LRUCache } from "lru-cache";

import { IS_TESTNET } from "../../../../env";
import { PoolRawResponse } from "../../../../queries/osmosis";
import { queryPools } from "../../../../queries/sidecar";
import { DEFAULT_LRU_OPTIONS } from "../../../../utils/cache";
import { getAsset } from "../../assets";
import { DEFAULT_VS_CURRENCY } from "../../assets/config";
import { getCosmwasmPoolTypeFromCodeId } from "../env";
import { Pool, PoolType } from "../index";

type SidecarPool = Awaited<ReturnType<typeof queryPools>>[number];

const poolsCache = new LRUCache<string, CacheEntry>(DEFAULT_LRU_OPTIONS);

/** Lightly cached pools from sidecar service. */
export function getPoolsFromSidecar({
  assetLists,
  poolIds,
  minLiquidityUsd,
}: {
  assetLists: AssetList[];
  chainList: Chain[];
  poolIds?: string[];
  minLiquidityUsd?: number;
}): Promise<Pool[]> {
  return cachified({
    cache: poolsCache,
    key:
      (poolIds ? `sidecar-pools-${poolIds.join(",")}` : "sidecar-pools") +
      minLiquidityUsd,
    ttl: 5_000, // 5 seconds
    getFreshValue: async () => {
      const sidecarPools = await timeout(
        () =>
          queryPools({ poolIds, minLiquidityCap: minLiquidityUsd?.toString() }),
        9_000, // 9 seconds
        "sidecarQueryPools"
      )();
      const reserveCoins = sidecarPools.map((sidecarPool) => {
        try {
          return getListedReservesFromSidecarPool(assetLists, sidecarPool);
        } catch {
          // Do nothing since low liq pools often contain unlisted tokens
        }
      });

      return sidecarPools
        .map((sidecarPool, index) =>
          makePoolFromSidecarPool({
            sidecarPool,
            reserveCoins: reserveCoins[index] ?? null,
          })
        )
        .filter(Boolean) as Pool[];
    },
  });
}

/** Converts a single SQS pool model response to the standard and more useful Pool type. */
function makePoolFromSidecarPool({
  sidecarPool,
  reserveCoins,
}: {
  sidecarPool: SidecarPool;
  reserveCoins: CoinPretty[] | null;
}): Pool | undefined {
  // contains unlisted or invalid assets
  // We avoid this check in testnet because we would like to show the pools even if we don't have accurate listing
  // to ease integrations.
  if (!reserveCoins && !IS_TESTNET) return;

  return {
    id: getPoolIdFromChainPool(sidecarPool.chain_model),
    type: getPoolTypeFromChainPool(sidecarPool.chain_model),
    raw: makePoolRawResponseFromChainPool(sidecarPool.chain_model),
    spreadFactor: new RatePretty(sidecarPool.spread_factor),

    // We expect the else case to occur only in testnet
    reserveCoins: reserveCoins ? reserveCoins : [],
    totalFiatValueLocked: new PricePretty(
      DEFAULT_VS_CURRENCY,
      sidecarPool.liquidity_cap
    ),
  };
}

function getPoolIdFromChainPool(
  chain_model: SidecarPool["chain_model"]
): string {
  return (
    "pool_id" in chain_model ? chain_model.pool_id : chain_model.id
  ).toString();
}

// since type URL was removed from chain_model in sidecar response
// we use the different shapes of the pool model to derive the pool type
export function getPoolTypeFromChainPool(
  chain_model: SidecarPool["chain_model"]
): PoolType {
  if ("pool_assets" in chain_model) return "weighted";
  if ("scaling_factors" in chain_model) return "stable";
  if ("current_sqrt_price" in chain_model) return "concentrated";
  if ("code_id" in chain_model) {
    return getCosmwasmPoolTypeFromCodeId(chain_model.code_id.toString());
  }
  throw new Error("Unknown pool type: " + JSON.stringify(chain_model));
}

/** @throws if an asset is not in asset list or balances are invalid. */
export function getListedReservesFromSidecarPool(
  assetLists: AssetList[],
  sidecarPool: SidecarPool
): CoinPretty[] {
  const poolDenoms = getPoolDenomsFromSidecarPool(sidecarPool);
  const listedBalances = poolDenoms.map((denom) => {
    const asset = getAsset({ assetLists, anyDenom: denom });
    const amount = sidecarPool.balances.find(
      (balance) => balance.denom === denom
    )?.amount;
    // no balance
    if (!amount) throw new Error("No balance for asset: " + denom);
    return new CoinPretty(asset, amount);
  });

  return listedBalances as CoinPretty[];
}

function getPoolDenomsFromSidecarPool({ chain_model, balances }: SidecarPool) {
  if ("pool_assets" in chain_model) {
    return chain_model.pool_assets.map((asset) => asset.token.denom);
  }

  if ("pool_liquidity" in chain_model) {
    return chain_model.pool_liquidity.map(({ denom }) => denom);
  }

  if ("token0" in chain_model) {
    return [chain_model.token0, chain_model.token1];
  }

  // this only works if balances from endpoint only contain balances for assets
  // traded in that pool
  return balances.map(({ denom }) => denom);
}

/** Sidecar made some type changes to the underlying pool, so we map those changes back to the sidecar type.  */
function makePoolRawResponseFromChainPool(
  chainPool: SidecarPool["chain_model"]
): PoolRawResponse {
  // CL pools
  if ("current_tick_liquidity" in chainPool) {
    return {
      ...chainPool,
      id: chainPool.id?.toString(),
      current_tick: chainPool.current_tick?.toString(),
      tick_spacing: chainPool.tick_spacing?.toString(),
      exponent_at_price_one: chainPool.exponent_at_price_one?.toString(),
    } as PoolRawResponse;
  }

  // Stable pools
  if ("scaling_factors" in chainPool) {
    return {
      ...chainPool,
      id: chainPool.id?.toString(),
      scaling_factors: chainPool.scaling_factors?.map((factor) =>
        factor.toString()
      ),
    } as PoolRawResponse;
  }

  // Weighted pools
  if ("total_weight" in chainPool) {
    return {
      ...chainPool,
      id: chainPool.id?.toString(),
      // SQS diverges from the node model by returning total_weight as a string decimal instead of string integer
      total_weight: chainPool.total_weight.split(".")[0],
    } as PoolRawResponse;
  }

  // Cosmwasm pools
  return {
    ...chainPool,
    pool_id: chainPool.pool_id?.toString(),
    code_id: chainPool.code_id?.toString(),
  } as PoolRawResponse;
}
