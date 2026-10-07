import { Role, User } from '@prisma/client';
import {
  TEAM_FILTER_NONE,
  buildTeamIdCondition,
} from '../src/utils/team-filter.util';
import { buildQuoteWhereClause } from '../src/utils/quote-filter.util';

const adminUser = { id: 'u1', role: Role.ADMIN } as User;

// Các điều kiện trong where.AND có đụng tới requester.teamId
const teamConditions = (where: any): any[] =>
  (where.AND ?? []).filter(
    (c: any) =>
      c?.requester &&
      Object.prototype.hasOwnProperty.call(c.requester, 'teamId'),
  );

describe('buildTeamIdCondition', () => {
  it.each([undefined, '', 'ALL'])('%p → undefined (bỏ lọc)', (value) => {
    expect(buildTeamIdCondition(value as string | undefined)).toBeUndefined();
  });

  it("'NONE' → { teamId: null } (người chưa có team)", () => {
    expect(TEAM_FILTER_NONE).toBe('NONE');
    expect(buildTeamIdCondition('NONE')).toEqual({ teamId: null });
  });

  it('id team → { teamId: id }', () => {
    expect(buildTeamIdCondition('t1')).toEqual({ teamId: 't1' });
  });
});

describe('buildQuoteWhereClause — teamId', () => {
  it('teamId = id → lọc theo requester.teamId', () => {
    const where: any = buildQuoteWhereClause(
      { teamId: 't1' } as any,
      adminUser,
    );
    expect(where.AND).toContainEqual({ requester: { teamId: 't1' } });
  });

  it("teamId = 'NONE' → requester.teamId null (Sale chưa có team)", () => {
    const where: any = buildQuoteWhereClause(
      { teamId: 'NONE' } as any,
      adminUser,
    );
    expect(where.AND).toContainEqual({ requester: { teamId: null } });
  });

  it.each([undefined, '', 'ALL'])(
    'teamId = %p → không thêm điều kiện team',
    (value) => {
      const where: any = buildQuoteWhereClause(
        { teamId: value } as any,
        adminUser,
      );
      expect(teamConditions(where)).toHaveLength(0);
    },
  );

  it('không có teamId → không phần tử AND nào có requester.teamId', () => {
    const where: any = buildQuoteWhereClause({} as any, adminUser);
    expect(teamConditions(where)).toHaveLength(0);
  });
});
