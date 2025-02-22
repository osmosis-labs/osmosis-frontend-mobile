import { Transition } from "@headlessui/react";
import { isNil } from "@osmosis-labs/utils";
import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { memo, PropsWithChildren, useEffect, useState } from "react";

import { Icon } from "~/components/assets";
import { ErrorBoundary } from "~/components/error/error-boundary";
import { GeneralErrorScreen } from "~/components/error/general-error-screen";
import { Screen, ScreenManager } from "~/components/screen-manager";
import { StepProgress } from "~/components/stepper/progress-bar";
import { IconButton } from "~/components/ui/button";
import { EventName } from "~/config";
import { useTranslation, useWindowKeyActions } from "~/hooks";
import { BridgeFlowProvider } from "~/hooks/bridge";
import { useAmplitudeAnalytics } from "~/hooks/use-amplitude-analytics";
import { useDisclosure } from "~/hooks/use-disclosure";
import { FiatRampKey } from "~/integrations";
import { FiatOnrampSelectionModal } from "~/modals/fiat-on-ramp-selection";
import { FiatRampsModal } from "~/modals/fiat-ramps";

import { AmountAndReviewScreen } from "./amount-and-review-screen";
import { AssetSelectScreen } from "./asset-select-screen";

export enum ImmersiveBridgeScreen {
  Asset = "0",
  Amount = "1",
  Review = "2",
}

const MemoizedChildren = memo(({ children }: PropsWithChildren) => {
  return <>{children}</>;
});

export const ImmersiveBridgeFlow = ({
  Provider,
  children,
}: PropsWithChildren<BridgeFlowProvider>) => {
  const { t } = useTranslation();
  const { logEvent } = useAmplitudeAnalytics();

  const [isVisible, setIsVisible] = useState(false);
  const [step, setStep] = useState<ImmersiveBridgeScreen>(
    ImmersiveBridgeScreen.Asset
  );
  const [direction, setDirection] = useQueryState<
    "deposit" | "withdraw" | null
  >("transferDirection", {
    history: "replace",
    parse: (value) => (value === "withdraw" ? "withdraw" : "deposit"),
  });
  const [selectedAssetDenom, setSelectedAssetDenom] = useQueryState<
    string | null
  >("transferAsset", {
    defaultValue: null,
    history: "replace",
    parse: (value) => {
      if (typeof value === "string") return value;
      return null;
    },
  });

  useEffect(() => {
    if (!isNil(direction) && !isVisible) setIsVisible(true);
    if (isNil(direction) && isVisible) setDirection("deposit"); // default direction
    if (!isNil(selectedAssetDenom) && !isVisible) {
      setIsVisible(true);
      setStep(ImmersiveBridgeScreen.Amount);
      logEvent([
        EventName.DepositWithdraw.assetSelected,
        {
          tokenName: selectedAssetDenom,
        },
      ]);
    }
  }, [direction, selectedAssetDenom, isVisible, setDirection, logEvent]);

  const [fiatRampParams, setFiatRampParams] = useState<{
    fiatRampKey: FiatRampKey;
    assetKey: string;
  } | null>(null);

  const {
    isOpen: isFiatOnrampSelectionOpen,
    onOpen: onOpenFiatOnrampSelection,
    onClose: onCloseFiatOnrampSelection,
  } = useDisclosure();

  useEffect(() => {
    if (isVisible) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    return () => {
      document.body.style.overflow = "auto";
    };
  }, [isVisible]);

  const onClose = () => {
    setIsVisible(false);
    setDirection(null);
    setSelectedAssetDenom(null);
  };

  const onOpen = (direction: "deposit" | "withdraw") => {
    setIsVisible(true);
    setDirection(direction);
  };

  useWindowKeyActions({
    Escape: onClose,
  });

  return (
    <Provider
      value={{
        startBridge: ({ direction }: { direction: "deposit" | "withdraw" }) => {
          onOpen(direction);
        },
        bridgeAsset: async ({
          anyDenom,
          direction,
        }: {
          anyDenom: string;
          direction: "deposit" | "withdraw";
        }) => {
          onOpen(direction);
          setStep(ImmersiveBridgeScreen.Amount);
          setSelectedAssetDenom(anyDenom);
          logEvent([
            EventName.DepositWithdraw.assetSelected,
            {
              tokenName: anyDenom,
            },
          ]);
        },
        fiatRamp: ({
          fiatRampKey,
          assetKey,
        }: {
          fiatRampKey: FiatRampKey;
          assetKey: string;
        }) => {
          setFiatRampParams({ fiatRampKey, assetKey });
        },
        fiatRampSelection: onOpenFiatOnrampSelection,
      }}
    >
      <MemoizedChildren>{children}</MemoizedChildren>

      <ScreenManager
        currentScreen={String(step)}
        onChangeScreen={(screen) => setStep(screen as ImmersiveBridgeScreen)}
      >
        {({ currentScreen }) => {
          return (
            <Transition
              show={isVisible}
              as="div"
              className="fixed inset-0 z-[999] flex h-screen w-screen bg-osmoverse-900"
              enter="transition-opacity duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
              afterLeave={() => {
                setSelectedAssetDenom(null);
                setStep(ImmersiveBridgeScreen.Asset);
              }}
            >
              <QueryErrorResetBoundary>
                {({ reset: resetQueries }) => (
                  <ErrorBoundary
                    FallbackComponent={(props) => (
                      <GeneralErrorScreen {...props} onClose={onClose} />
                    )}
                    onReset={resetQueries}
                  >
                    <div className="flex-1 overflow-y-auto">
                      <div className="sticky top-0 z-50 mx-auto flex max-w-7xl place-content-between items-center gap-3 bg-osmoverse-900 py-8 px-10">
                        {step === ImmersiveBridgeScreen.Asset ? (
                          <div className="h-12 w-12 flex-shrink-0 md:h-8 md:w-8" />
                        ) : (
                          <IconButton
                            aria-label="Go Back"
                            className="z-50 !h-12 !w-12 flex-shrink-0 text-wosmongton-200 hover:text-osmoverse-100 md:!h-8 md:!w-8"
                            icon={
                              <Icon
                                id="arrow-left-thin"
                                className="md:h-4 md:w-4"
                              />
                            }
                            onClick={() => {
                              setStep(
                                (
                                  Number(step) - 1
                                ).toString() as ImmersiveBridgeScreen
                              );
                              if (step === ImmersiveBridgeScreen.Amount) {
                                setSelectedAssetDenom(null);
                              }
                            }}
                          />
                        )}
                        <StepProgress
                          className="mx-6 max-w-3xl shrink md:hidden"
                          steps={[
                            {
                              displayLabel: t("transfer.stepLabels.asset"),
                              onClick:
                                step !== ImmersiveBridgeScreen.Asset
                                  ? () => {
                                      setStep(ImmersiveBridgeScreen.Asset);
                                      setSelectedAssetDenom(null);
                                    }
                                  : undefined,
                            },
                            {
                              displayLabel: t("transfer.stepLabels.amount"),
                              onClick:
                                step === ImmersiveBridgeScreen.Review
                                  ? () => setStep(ImmersiveBridgeScreen.Amount)
                                  : undefined,
                            },
                            {
                              displayLabel: t("transfer.stepLabels.review"),
                            },
                          ]}
                          currentStep={Number(step)}
                        />
                        <IconButton
                          aria-label="Close"
                          className="z-50 !h-12 !w-12 flex-shrink-0 text-wosmongton-200 hover:text-osmoverse-100 md:!h-8 md:!w-8"
                          icon={<Icon id="close" className="md:h-4 md:w-4" />}
                          onClick={onClose}
                        />
                      </div>

                      <div className="w-full flex-1">
                        <div className="mx-auto max-w-lg md:px-4">
                          <Screen screenName={ImmersiveBridgeScreen.Asset}>
                            {({ setCurrentScreen }) =>
                              direction ? (
                                <AssetSelectScreen
                                  type={direction}
                                  onSelectAsset={({ coinDenom }) => {
                                    setCurrentScreen(
                                      ImmersiveBridgeScreen.Amount
                                    );
                                    setSelectedAssetDenom(coinDenom);
                                    logEvent([
                                      EventName.DepositWithdraw.assetSelected,
                                      {
                                        tokenName: coinDenom,
                                      },
                                    ]);
                                  }}
                                />
                              ) : null
                            }
                          </Screen>
                          {currentScreen !== ImmersiveBridgeScreen.Asset &&
                            direction && (
                              <AmountAndReviewScreen
                                direction={direction}
                                onClose={onClose}
                                selectedAssetDenom={selectedAssetDenom}
                              />
                            )}
                        </div>
                      </div>
                    </div>
                  </ErrorBoundary>
                )}
              </QueryErrorResetBoundary>
            </Transition>
          );
        }}
      </ScreenManager>

      {!isNil(fiatRampParams) && (
        <FiatRampsModal
          isOpen
          onRequestClose={() => {
            setFiatRampParams(null);
          }}
          assetKey={fiatRampParams.assetKey}
          fiatRampKey={fiatRampParams.fiatRampKey}
        />
      )}
      <FiatOnrampSelectionModal
        isOpen={isFiatOnrampSelectionOpen}
        onRequestClose={onCloseFiatOnrampSelection}
        onSelectRamp={() => {
          logEvent([EventName.ProfileModal.buyTokensClicked]);
        }}
      />
    </Provider>
  );
};
