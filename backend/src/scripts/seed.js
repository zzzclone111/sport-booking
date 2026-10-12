const bcrypt = require("bcryptjs");
const { pool } = require("../db");

async function main() {
  const passwordHash = await bcrypt.hash("SportHub@123", 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const users = [
      ["Nguyễn Minh Anh", "renter@sporthub.vn", "0901000001", "RENTER"],
      ["Trần Hoàng Nam", "owner@sporthub.vn", "0901000002", "OWNER"],
      ["Quản trị SportHub", "admin@sporthub.vn", "0901000003", "ADMIN"],
    ];
    const ids = {};
    for (const [name, email, phone, role] of users) {
      const result = await client.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [name, email, phone, passwordHash, role],
      );
      ids[role] = result.rows[0].id;
    }

    const existingVenue = await client.query(
      "SELECT id FROM venues WHERE owner_id=$1 AND name='SportHub Thảo Điền' LIMIT 1",
      [ids.OWNER],
    );
    const venueResult = existingVenue.rowCount
      ? existingVenue
      : await client.query(
          `INSERT INTO venues (
        owner_id, name, description, address, ward, district, city,
        image_url, amenities, open_time, close_time, status
      ) VALUES (
        $1, 'SportHub Thảo Điền', 'Cụm sân thể thao hiện đại, phòng thay đồ sạch và bãi xe rộng.',
        '18 Xuân Thủy', 'Thảo Điền', 'Thủ Đức', 'Hồ Chí Minh',
        'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1200&q=80',
        ARRAY['Bãi xe', 'Phòng tắm', 'Nước uống', 'Wifi'], '06:00', '23:00', 'ACTIVE'
      ) ON CONFLICT DO NOTHING RETURNING id`,
          [ids.OWNER],
        );
    let venueId = venueResult.rows[0]?.id;
    if (!venueId) {
      venueId = (
        await client.query(
          "SELECT id FROM venues WHERE owner_id = $1 AND name = 'SportHub Thảo Điền' LIMIT 1",
          [ids.OWNER],
        )
      ).rows[0].id;
    }

    const courts = [
      ["Sân cầu lông A1", "Cầu lông", "Thảm PVC", 120000],
      ["Sân cầu lông A2", "Cầu lông", "Thảm PVC", 120000],
      ["Sân bóng đá B1", "Bóng đá", "Cỏ nhân tạo", 500000],
      ["Sân pickleball C1", "Pickleball", "Acrylic", 180000],
    ];
    for (const court of courts) {
      await client.query(
        `INSERT INTO courts (venue_id, name, sport_type, surface, price_per_hour)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (venue_id, name) DO NOTHING`,
        [venueId, ...court],
      );
    }
    await client.query(
      `INSERT INTO pricing_rules(court_id,day_of_week,start_time,end_time,price_per_hour)
      SELECT c.id,NULL,'17:00'::time,'21:00'::time,c.price_per_hour*1.5 FROM courts c
      WHERE c.venue_id=$1 AND NOT EXISTS(SELECT 1 FROM pricing_rules p WHERE p.court_id=c.id)`,
      [venueId],
    );
    await client.query("COMMIT");
    console.log("Seed complete. Demo password: SportHub@123");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
