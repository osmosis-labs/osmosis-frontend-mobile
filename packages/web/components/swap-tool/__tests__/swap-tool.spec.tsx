/* eslint-disable import/no-extraneous-dependencies */
import { Dec, PricePretty } from "@keplr-wallet/unit";
import { DEFAULT_VS_CURRENCY, NumPoolsResponse } from "@osmosis-labs/server";
import { createCallerFactory } from "@osmosis-labs/trpc";
import { getAssetFromAssetList } from "@osmosis-labs/utils";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { rest } from "msw";
import mockRouter from "next-router-mock";

import { server, trpcMsw } from "~/__tests__/msw";
import { renderWithProviders } from "~/__tests__/test-utils";
import { SwapTool } from "~/components/swap-tool";
import { AssetLists } from "~/config/generated/asset-lists";
import { ChainList } from "~/config/generated/chain-list";
import { appRouter } from "~/server/api/root-router";

jest.mock("next/router", () => jest.requireActual("next-router-mock"));

// Mock the ResizeObserver
const ResizeObserverMock = jest.fn(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Stub the global ResizeObserver
global.ResizeObserver = ResizeObserverMock;

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({
  /**
   * The asset list and chain list used here are snapshots of the
   * production asset list. In case of discrepancies due to outdated
   * assets or chains, consider updating these mocks.
   */
  assetLists: AssetLists,
  chainList: ChainList,
});

beforeEach(() => {
  server.use(
    trpcMsw.edge.assets.getUserAssets.query(async (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.data(await caller.edge.assets.getUserAssets(req.getInput()))
      );
    }),
    trpcMsw.edge.assets.getAssetPrice.query((_req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.data(new PricePretty(DEFAULT_VS_CURRENCY, new Dec(1)))
      );
    })
  );
});

afterEach(() => {
  mockRouter.setCurrentUrl("/");
});

it("should return only pool assets when sending a pool id and useOtherCurrencies is true", async () => {
  const poolId = "908";
  const rawPoolTokens = [
    {
      denom:
        "ibc/0CD3A0285E1341859B5E86B6AB7682F023D03E97607CCC1DC95706411D866DF7",
      amount: "249.68336812445327",
      name: "Dai Stablecoin",
      symbol: "DAI",
      display: "dai",
      exponent: "18",
      coingecko_id: "dai",
      weight_or_scaling: "1000000000000",
      percent: "0.999999999998",
      price: "1.0009205128376601",
      price_24h_change: "-0.0005927567076408077",
    },
    {
      denom:
        "ibc/23CA6C8D1AB2145DD13EB1E089A2E3F960DC298B468CCE034E19E5A78B61136E",
      amount: "823.563328",
      name: "CMST",
      symbol: "CMST",
      display: "cmst",
      exponent: "6",
      coingecko_id: "composite",
      weight_or_scaling: "1",
      percent: "9.99999999998e-13",
      price: "0.7051241017886",
      price_24h_change: "0.7037924681345253",
    },
    {
      denom:
        "ibc/92BE0717F4678905E53F4E45B2DED18BC0CB97BF1F8B6A25AFEDF3D5A879B4D5",
      amount: "250.470027",
      name: "Inter Stable Token",
      symbol: "IST",
      display: "ist",
      exponent: "6",
      coingecko_id: "inter-stable-token",
      weight_or_scaling: "1",
      percent: "9.99999999998e-13",
      price: "1.0004902227514614",
      price_24h_change: "0.07891367083611964",
    },
  ];
  const assets = rawPoolTokens.map((rawToken) =>
    getAssetFromAssetList({
      assetLists: AssetLists,
      coinMinimalDenom: rawToken.denom,
    })
  );

  expect(assets).toHaveLength(3);

  server.use(
    rest.get("https://sqs.osmosis.zone/pools", (_req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json([
          {
            chain_model: {
              address:
                "osmo1mw0ac6rwlp5r8wapwk3zs6g29h8fcscxqakdzw9emkne6c8wjp9q0t3v8t",
              id: Number(poolId),
              pool_params: {
                swap_fee: "0.002000000000000000",
                exit_fee: "0.000000000000000000",
              },
              future_pool_governor: "24h",
              total_weight: "1073741824000000.000000000000000000",
              total_shares: {
                denom: `gamm/pool/${poolId}`,
                amount: "8443258129578637381630355637",
              },
              pool_assets: rawPoolTokens.map((token) => ({
                token: { denom: token.denom, amount: token.amount },
                weight: token.weight_or_scaling,
              })),
            },
            balances: rawPoolTokens.map((token) => ({
              denom: token.denom,
              amount: token.amount,
            })),
            type: 0,
            spread_factor: "0.002000000000000000",
            liquidity_cap: "6822727",
            liquidity_cap_error: "",
          },
        ])
      );
    }),
    rest.get(
      "https://lcd-osmosis.keplr.app/osmosis/poolmanager/v1beta1/num_pools",
      (_req, res, ctx) => {
        return res(
          ctx.status(200),
          ctx.json({ num_pools: "1" } as NumPoolsResponse)
        );
      }
    )
  );

  renderWithProviders(
    <SwapTool
      page="Pool Details Page"
      useOtherCurrencies
      initialSendTokenDenom={assets[0]?.symbol}
      initialOutTokenDenom={assets[1]?.symbol}
      useQueryParams={false}
      forceSwapInPoolId={poolId}
    />
  );

  await waitFor(() => {
    expect(screen.getByText("Swap")).toBeInTheDocument();
  });

  // Click on asset 1 to open drawer
  const fromTokenButton = screen.getByRole("button", {
    name: `Select 'from' token. Current token is ${assets[0]!.symbol}`,
  });
  expect(fromTokenButton).toBeInTheDocument();

  // asset 3 should not be visible as the token select list is not open
  expect(screen.queryByText(assets[2]!.symbol)).toBeNull();

  await userEvent.click(fromTokenButton);

  // Check if drawer is open
  expect(await screen.findByText("Select a token")).toBeInTheDocument();

  // IST should be in the list
  expect(screen.getByText(assets[2]!.symbol)).toBeInTheDocument();

  // Recommended assets should not be visible
  expect(screen.queryByTestId("recommended-assets-container")).toBeNull();

  // Search box should not be visible
  expect(screen.queryByPlaceholderText("Search")).toBeNull();

  // Only the pool assets should be visible, including the to and from tokens
  expect(screen.getAllByTestId("token-select-asset")).toHaveLength(3);

  // Close drawer
  userEvent.click(screen.getByRole("button", { name: "Close" }));

  // Should have been closed
  await waitFor(() => {
    expect(screen.queryByText("Select a token")).toBeNull();
  });

  // Click on asset 2 to open drawer
  const toTokenButton = screen.getByRole("button", {
    name: `Select 'to' token. Current token is ${assets[1]!.symbol}`,
  });

  // asset 3 should not be visible as the token select list is not open
  expect(screen.queryByText(assets[2]!.symbol)).toBeNull();

  await userEvent.click(toTokenButton);

  // Check if drawer is open
  expect(await screen.findByText("Select a token")).toBeInTheDocument();

  // IST should be in the list
  expect(screen.getByText(assets[2]!.symbol)).toBeInTheDocument();

  // Recommended assets should not be visible
  expect(screen.queryByTestId("recommended-assets-container")).toBeNull();

  // Search box should not be visible
  expect(screen.queryByPlaceholderText("Search")).toBeNull();

  // Only the pool assets should be visible, including the to and from tokens
  expect(screen.getAllByTestId("token-select-asset")).toHaveLength(3);
});
