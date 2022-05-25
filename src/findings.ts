import { Finding, FindingSeverity, FindingType } from 'forta-agent';

export const createImpersonatedTokenDeploymentFinding = (
  tokenName: string,
  deployerAddress: string,
  legitimateContractAddress: string,
  impersonatingContractAddress: string,
) => {
  return Finding.from({
    alertId: 'IMPERSONATED-TOKEN-DEPLOYMENT',
    name: 'Impersonating Token Contract',
    description:
      `${deployerAddress} deployed an impersonating token contract at ${impersonatingContractAddress}. ` +
      `It impersonates token ${tokenName} at ${legitimateContractAddress}`,
    type: FindingType.Suspicious,
    severity: FindingSeverity.Medium,
    addresses: [deployerAddress, legitimateContractAddress, impersonatingContractAddress],
    metadata: {},
  });
};

// Generic alert
export const createImpersonatedTokenFinding = (
  tokenName: string,
  legitimateContractAddress: string,
  impersonatingContractAddress: string,
) => {
  return Finding.from({
    alertId: 'IMPERSONATED-TOKEN-FINDING',
    name: 'Impersonating Token Contract',
    description:
      `Found an impersonating token at ${impersonatingContractAddress}. ` +
      `It impersonates token ${tokenName} at ${legitimateContractAddress}`,
    type: FindingType.Suspicious,
    severity: FindingSeverity.Low,
    addresses: [legitimateContractAddress, impersonatingContractAddress],
    metadata: {},
  });
};
