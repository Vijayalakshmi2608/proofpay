"use client";

import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CreateMilestoneInput = {
  contractorAccountId: string;
  fundingAsset: "NEAR" | "USDC";
  amountBaseUnits: string;
  autoReleaseLimitBaseUnits: string;
  proofRequirements: string;
  deadlineNs: string;
  destinationChain: string;
  payoutRecipient: string;
};

export type SubmitProofInput = {
  milestoneId: number;
  proofHash: string;
  proofUrl: string;
};

type Selector = Awaited<ReturnType<typeof setupWalletSelector>>;
type WalletContextValue = {
  accountId: string | null;
  isReady: boolean;
  isConnecting: boolean;
  network: "testnet" | "mainnet";
  connect: () => void;
  disconnect: () => Promise<void>;
  createMilestoneTransaction: (input: CreateMilestoneInput) => Promise<unknown>;
  submitProofTransaction: (input: SubmitProofInput) => Promise<unknown>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const network: "testnet" | "mainnet" = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const [selector, setSelector] = useState<Selector | null>(null);
  const [modal, setModal] = useState<ReturnType<typeof setupModal> | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    async function initialize() {
      try {
        const nodeUrl = new URL(`/api/near-rpc?network=${network}`, window.location.origin).toString();
        const walletSelector = await setupWalletSelector({
          network: {
            networkId: network,
            nodeUrl,
            helperUrl: `https://helper.${network}.near.org`,
            explorerUrl: `https://explorer.${network}.near.org`,
            indexerUrl: `https://indexer.${network}.near.org`,
          },
          modules: [setupMyNearWallet(), setupHereWallet()],
        });
        const walletModal = setupModal(walletSelector, { contractId: process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID || undefined });
        if (!active) return;
        setSelector(walletSelector);
        setModal(walletModal);
        setAccountId(walletSelector.store.getState().accounts.find((item) => item.active)?.accountId ?? null);
        const subscription = walletSelector.store.observable.subscribe((state) => {
          setAccountId(state.accounts.find((item) => item.active)?.accountId ?? null);
          setIsConnecting(false);
        });
        unsubscribe = () => subscription.unsubscribe();
        setIsReady(true);
      } catch (error) {
        console.error("wallet_selector_init_failed", error);
        if (active) setIsReady(true);
      }
    }

    void initialize();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [network]);

  const connect = useCallback(() => {
    if (!modal) return;
    setIsConnecting(true);
    modal.show();
    window.setTimeout(() => setIsConnecting(false), 1_200);
  }, [modal]);

  const disconnect = useCallback(async () => {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
    setAccountId(null);
  }, [selector]);

  const createMilestoneTransaction = useCallback(async (input: CreateMilestoneInput) => {
    if (!selector) throw new Error("Wallet Selector is still initializing. Try again in a moment.");
    if (!accountId) throw new Error("Connect your NEAR wallet before creating a live milestone.");
    const contractId = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID;
    if (!contractId) throw new Error("Set NEXT_PUBLIC_NEAR_CONTRACT_ID to your deployed contract.");
    const wallet = await selector.wallet();

    if (input.fundingAsset === "USDC") {
      const tokenContractId = process.env.NEXT_PUBLIC_NEAR_USDC_CONTRACT?.trim();
      if (!tokenContractId) throw new Error("Set NEXT_PUBLIC_NEAR_USDC_CONTRACT before offering NEP-141 USDC funding.");
      return wallet.signAndSendTransaction({
        receiverId: tokenContractId,
        actions: [{
          type: "FunctionCall",
          params: {
            methodName: "ft_transfer_call",
            args: {
              receiver_id: contractId,
              amount: input.amountBaseUnits,
              msg: JSON.stringify({
                contractor: input.contractorAccountId,
                auto_release_limit: input.autoReleaseLimitBaseUnits,
                proof_requirements: input.proofRequirements,
                deadline: input.deadlineNs,
                destination_chain: input.destinationChain,
                payout_recipient: input.payoutRecipient,
              }),
            },
            gas: "100000000000000",
            deposit: "1",
          },
        }],
      });
    }

    return wallet.signAndSendTransaction({
      receiverId: contractId,
      actions: [{
        type: "FunctionCall",
        params: {
          methodName: "create_milestone_with_options",
          args: {
            contractor: input.contractorAccountId,
            auto_release_limit: input.autoReleaseLimitBaseUnits,
            proof_requirements: input.proofRequirements,
            deadline: input.deadlineNs,
            destination_chain: input.destinationChain,
            payout_recipient: input.payoutRecipient,
          },
          gas: "30000000000000",
          deposit: input.amountBaseUnits,
        },
      }],
    });
  }, [selector, accountId]);

  const submitProofTransaction = useCallback(async (input: SubmitProofInput) => {
    if (!selector) throw new Error("Wallet Selector is still initializing. Try again in a moment.");
    if (!accountId) throw new Error("Connect your NEAR wallet before submitting proof.");
    const contractId = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID;
    if (!contractId) throw new Error("Set NEXT_PUBLIC_NEAR_CONTRACT_ID to your deployed contract.");
    const wallet = await selector.wallet();
    return wallet.signAndSendTransaction({
      receiverId: contractId,
      actions: [{
        type: "FunctionCall",
        params: {
          methodName: "submit_proof",
          args: { milestone_id: input.milestoneId, proof_hash: input.proofHash, proof_url: input.proofUrl },
          gas: "30000000000000",
          deposit: "0",
        },
      }],
    });
  }, [selector, accountId]);

  const value = useMemo(() => ({
    accountId,
    isReady,
    isConnecting,
    network,
    connect,
    disconnect,
    createMilestoneTransaction,
    submitProofTransaction,
  }), [accountId, isReady, isConnecting, network, connect, disconnect, createMilestoneTransaction, submitProofTransaction]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within WalletProvider");
  return context;
}
