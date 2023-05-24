import { EntityType, Finding, FindingSeverity, FindingType } from 'forta-agent';
import { Token } from './types';

const HIGH_SEVERITY_ALERT_ID = 'IMPERSONATED-TOKEN-DEPLOYMENT-POPULAR';
const MEDIUM_SEVERITY_ALERT_ID = 'IMPERSONATED-TOKEN-DEPLOYMENT';

const createFinding = (
  alertId: string,
  newToken: Token,
  oldToken: Token,
  severity: FindingSeverity,
  anomalyScore: number,
) => {
  const writeName = (token: Token) => {
    let str = '';

    if (token.symbol) str = token.symbol;
    if (token.symbol && token.name) str += ` (${token.name})`;
    if (!token.symbol && token.name) str = token.name;

    return str;
  };

  return Finding.from({
    alertId: alertId,
    name: 'Impersonating Token Contract',
    description:
      `${newToken.deployer} deployed an impersonating token contract at ${newToken.address}. ` +
      `It impersonates token ${writeName(oldToken)} at ${oldToken.address}`,
    type: FindingType.Suspicious,
    severity: severity,
    addresses: [newToken.deployer, oldToken.deployer, newToken.address, oldToken.address],
    labels: [
      {
        entityType: EntityType.Address,
        label: 'Victim',
        metadata: {},
        entity: oldToken.deployer,
        confidence: 0.5,
        remove: false,
      },
      {
        entityType: EntityType.Address,
        label: 'Victim',
        entity: oldToken.address,
        confidence: 0.5,
        metadata: {},
        remove: false,
      },
      {
        entityType: EntityType.Address,
        label: 'Scam',
        entity: newToken.address,
        confidence: 0.5,
        metadata: {},
        remove: false,
      },
      {
        entityType: EntityType.Address,
        label: 'Scammer',
        entity: newToken.deployer,
        confidence: 0.5,
        metadata: {},
        remove: false,
      },
    ],
    metadata: {
      newTokenSymbol: newToken.symbol || '',
      newTokenName: newToken.name || '',
      oldTokenSymbol: oldToken.symbol || '',
      oldTokenName: oldToken.name || '',
      newTokenDeployer: newToken.deployer,
      newTokenContract: newToken.address,
      oldTokenDeployer: oldToken.deployer,
      oldTokenContract: oldToken.address,
      anomalyScore: String(anomalyScore),
    },
  });
};

export const createFindingMediumSeverity = (
  newToken: Token,
  oldToken: Token,
  anomalyScore: number,
) => {
  return createFinding(
    MEDIUM_SEVERITY_ALERT_ID,
    newToken,
    oldToken,
    FindingSeverity.Medium,
    anomalyScore,
  );
};

export const createFindingHighSeverity = (
  newToken: Token,
  oldToken: Token,
  anomalyScore: number,
) => {
  return createFinding(
    HIGH_SEVERITY_ALERT_ID,
    newToken,
    oldToken,
    FindingSeverity.High,
    anomalyScore,
  );
};
