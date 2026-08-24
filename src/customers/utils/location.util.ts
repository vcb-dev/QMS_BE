import { PrismaService } from '../../prisma/prisma.service';

export type LocationInput = {
  province?: string;
  provinceId?: string;
  ward?: string;
  wardId?: string;
};

// Đồng bộ 2 chiều giữa string tự do (cũ) và FK provinceId/wardId (mới) — nơi gọi gửi id thì tự
// tra tên để giữ cột string cũ khớp theo; chỉ gửi tên (form cũ chưa đổi UI) thì tự match tên để
// điền luôn id, để customer mới tạo ở bất kỳ luồng nào cũng có FK ngay mà không cần sửa FE trước.
export async function resolveLocation(
  prisma: PrismaService,
  input: LocationInput,
): Promise<LocationInput> {
  let { province, provinceId, ward, wardId } = input;

  if (provinceId) {
    const p = await prisma.province.findUnique({
      where: { id: provinceId },
      select: { name: true },
    });
    if (p) province = p.name;
  } else if (province) {
    const p = await prisma.province.findFirst({
      where: { name: province },
      select: { id: true },
    });
    if (p) provinceId = p.id;
  }

  if (wardId) {
    const w = await prisma.ward.findUnique({
      where: { id: wardId },
      select: { name: true },
    });
    if (w) ward = w.name;
  } else if (ward && provinceId) {
    const w = await prisma.ward.findFirst({
      where: { name: ward, provinceId },
      select: { id: true },
    });
    if (w) wardId = w.id;
  }

  return { province, provinceId, ward, wardId };
}
