// Điều kiện lọc theo team dùng chung (danh sách yêu cầu, hiệu suất nhân viên). THUẦN — giá trị lọc
// vào, điều kiện Prisma ra. Giá trị đặc biệt: 'ALL' hoặc trống = bỏ lọc; 'NONE' = chưa có team.

export const TEAM_FILTER_NONE = 'NONE';
const TEAM_FILTER_ALL = 'ALL';

// Trả điều kiện trên cột `teamId` của User (gắn thẳng vào `where` của user, hoặc bọc vào
// `{ requester: ... }` khi lọc đơn theo team của Sale tạo đơn). `undefined` = không lọc.
export function buildTeamIdCondition(
  teamId?: string,
): { teamId: string | null } | undefined {
  if (!teamId || teamId === TEAM_FILTER_ALL) return undefined;
  if (teamId === TEAM_FILTER_NONE) return { teamId: null };
  return { teamId };
}
