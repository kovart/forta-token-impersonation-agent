import { EntityType, Finding, FindingSeverity, FindingType, LabelType } from 'forta-agent';
import { Token } from './types';

export const createImpersonatedTokenFinding = (newToken: Token, oldToken: Token) => {
  const writeName = (token: Token) => {
    let str = '';

    if (token.symbol) str = token.symbol;
    if (token.symbol && token.name) str += ` (${token.name})`;
    if (!token.symbol && token.name) str = token.name;

    return str;
  };

  return Finding.from({
    alertId: 'IMPERSONATED-TOKEN-DEPLOYMENT',
    name: 'Impersonating Token Contract',
    description:
      `${newToken.deployer} deployed an impersonating token contract at ${newToken.address}. ` +
      `It impersonates token ${writeName(oldToken)} at ${oldToken.address}`,
    type: FindingType.Suspicious,
    severity: FindingSeverity.Medium,
    addresses: [newToken.deployer, oldToken.deployer, newToken.address, oldToken.address],
    labels: [
      {
        entityType: EntityType.Address,
        labelType: LabelType.Victim,
        entity: oldToken.address,
        confidence: 0.5,
        customValue: '',
      },
      {
        entityType: EntityType.Address,
        labelType: LabelType.Scam,
        entity: newToken.address,
        confidence: 0.6,
        customValue: '',
      },
      {
        entityType: EntityType.Address,
        labelType: LabelType.Attacker,
        entity: newToken.deployer,
        confidence: 0.5,
        customValue: '',
      },
    ],
    metadata: {},
  });
};
