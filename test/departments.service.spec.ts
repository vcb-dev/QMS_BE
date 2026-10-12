import { DepartmentsService } from '../src/departments/departments.service';

describe('DepartmentsService.findPaginated — đơn đã hủy', () => {
  it('số yêu cầu của mỗi phòng ban (_count.quoteRequests) không tính đơn đã hủy', async () => {
    const prisma: any = {
      department: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const svc = new DepartmentsService(prisma);

    await svc.findPaginated(1, 10);

    const { include } = prisma.department.findMany.mock.calls[0][0];
    expect(include._count.select.quoteRequests).toEqual({
      where: { status: { not: 'CANCELLED' } },
    });
  });
});
