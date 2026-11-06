/**
 * Seed list of real brands and their official domains, used for clone detection.
 * At runtime this is extended with brands verified through ENS records.
 */
export interface Brand {
  name: string;
  /** Registrable domains the brand really uses. */
  officialDomains: string[];
  /** Words that, when seen in a page title or domain, suggest the page claims to be this brand. */
  keywords: string[];
  /** ENS name whose `url` record confirms the official domain, when known. */
  ensName?: string;
  category: "crypto" | "bank" | "payments" | "broker" | "government";
}

export const SEED_BRANDS: Brand[] = [
  { name: "Uniswap", officialDomains: ["uniswap.org"], keywords: ["uniswap"], category: "crypto" },
  { name: "MetaMask", officialDomains: ["metamask.io"], keywords: ["metamask"], category: "crypto" },
  { name: "OpenSea", officialDomains: ["opensea.io"], keywords: ["opensea"], category: "crypto" },
  { name: "Coinbase", officialDomains: ["coinbase.com"], keywords: ["coinbase"], category: "crypto" },
  { name: "Binance", officialDomains: ["binance.com"], keywords: ["binance"], category: "crypto" },
  { name: "Ethereum", officialDomains: ["ethereum.org", "ethereum.foundation"], keywords: ["ethereum"], category: "crypto" },
  { name: "ENS", officialDomains: ["ens.domains"], keywords: ["ens domains"], category: "crypto" },
  { name: "Etherscan", officialDomains: ["etherscan.io"], keywords: ["etherscan"], category: "crypto" },
  { name: "Aave", officialDomains: ["aave.com"], keywords: ["aave"], category: "crypto" },
  { name: "Lido", officialDomains: ["lido.fi"], keywords: ["lido"], category: "crypto" },
  { name: "Ledger", officialDomains: ["ledger.com"], keywords: ["ledger live", "ledger wallet"], category: "crypto" },
  { name: "Trust Wallet", officialDomains: ["trustwallet.com"], keywords: ["trust wallet", "trustwallet"], category: "crypto" },
  { name: "Phantom", officialDomains: ["phantom.com", "phantom.app"], keywords: ["phantom wallet"], category: "crypto" },
  { name: "WazirX", officialDomains: ["wazirx.com"], keywords: ["wazirx"], category: "crypto" },
  { name: "CoinDCX", officialDomains: ["coindcx.com"], keywords: ["coindcx"], category: "crypto" },
  { name: "CoinSwitch", officialDomains: ["coinswitch.co"], keywords: ["coinswitch"], category: "crypto" },
  { name: "Zerodha", officialDomains: ["zerodha.com"], keywords: ["zerodha", "kite by zerodha"], category: "broker" },
  { name: "Groww", officialDomains: ["groww.in"], keywords: ["groww"], category: "broker" },
  { name: "Paytm", officialDomains: ["paytm.com"], keywords: ["paytm"], category: "payments" },
  { name: "PhonePe", officialDomains: ["phonepe.com"], keywords: ["phonepe"], category: "payments" },
  { name: "State Bank of India", officialDomains: ["sbi.co.in", "onlinesbi.sbi"], keywords: ["state bank of india", "onlinesbi", "sbi yono"], category: "bank" },
  { name: "HDFC Bank", officialDomains: ["hdfcbank.com"], keywords: ["hdfc bank", "hdfcbank"], category: "bank" },
  { name: "ICICI Bank", officialDomains: ["icicibank.com"], keywords: ["icici bank", "icicibank"], category: "bank" },
  { name: "DigiLocker", officialDomains: ["digilocker.gov.in"], keywords: ["digilocker"], category: "government" },
  { name: "Income Tax Department", officialDomains: ["incometax.gov.in"], keywords: ["income tax department", "income tax refund"], category: "government" },
];
