const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

// ------------------------
// Cấu hình từ biến môi trường
// ------------------------
const MONGO_URI = process.env.MONGO_URI;
const API_KEY ='Bot 1U3BclaZxMkciEskdCBP1lL7birGG5GbKFljvLATJykk9cdOfeXya4bT6G9s7zjZ';
const API_URL ='https://api.wolvesville.com/';

// ------------------------
// Kết nối MongoDB qua Mongoose
// ------------------------
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ------------------------
// Định nghĩa Schema và Models
// ------------------------

// Schema lưu thông tin người chơi (username, lịch sử đổi tên)
const userDataSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  oldusername: { type: String, default: '' }
});
const UserData = mongoose.model('UserData', userDataSchema);

// Schema lưu thông tin tracking (ai đang theo dõi ai)
const trackingSchema = new mongoose.Schema({
  player_id: { type: String, required: true },  // ID người chơi Wolvesville
  user_id: { type: String, required: true },      // ID Discord user hoặc ID khác bạn dùng để theo dõi
  start_time: { type: Date, default: Date.now },
  last_known_name: { type: String }
});
trackingSchema.index({ player_id: 1, user_id: 1 }, { unique: true });
const Tracking = mongoose.model('Tracking', trackingSchema);

// ------------------------
// Hàm cập nhật thông tin user_data nếu tên thay đổi
// Trả về { updated: boolean, addedOld: number }
// Nếu chưa có record thì tạo mới, nếu đã có mà tên khác thì cập nhật và thêm tên cũ vào
// ------------------------
async function checkAndUpdateUserName(userId, newName) {
  let updated = false;
  let addedOld = 0;
  let user = await UserData.findOne({ user_id: userId });
  if (!user) {
    user = new UserData({ user_id: userId, username: newName });
    await user.save();
  } else if (user.username !== newName) {
    let oldList = user.oldusername ? user.oldusername.trim() : '';
    // Thêm tên cũ vào danh sách
    oldList = oldList ? `${oldList}, ${user.username}` : user.username;
    user.username = newName;
    user.oldusername = oldList;
    await user.save();
    updated = true;
    addedOld = 1;
  }
  return { updated, addedOld };
}

// ------------------------
// Hàm sync với phân trang: Duyệt qua từng trang và cập nhật nếu có thay đổi tên
// ------------------------
async function syncPlayerNamesPaginated() {
  const pageSize = 100; // Số record mỗi trang
  let page = 0;
  let records = [];
  // Biến đếm tổng kết
  let totalUsersChanged = 0;
  let totalOldNamesAdded = 0;

  do {
    records = await Tracking.find({})
      .skip(pageSize * page)
      .limit(pageSize);

    if (records.length > 0) {
      console.log(`Đang xử lý trang ${page + 1} với ${records.length} record`);
      for (const record of records) {
        try {
          const res = await axios.get(`${API_URL}players/${record.player_id}`, {
            headers: {
              'Authorization': API_KEY,
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });
          const updatedPlayer = res.data;
          const newName = updatedPlayer.username ? updatedPlayer.username.trim() : '';
          const oldName = record.last_known_name ? record.last_known_name.trim() : '';

          // Nếu có thay đổi tên thì cập nhật
          if (newName && newName !== oldName) {
            await Tracking.findOneAndUpdate(
              { player_id: record.player_id, user_id: record.user_id },
              { last_known_name: newName }
            );
            const result = await checkAndUpdateUserName(record.player_id, newName);
            if (result.updated) {
              totalUsersChanged++;
              totalOldNamesAdded += result.addedOld;
            }
            console.log(`Cập nhật: Player ${record.player_id} đổi tên từ "${oldName}" thành "${newName}"`);
          }
        } catch (error) {
          if (error.response && error.response.status === 404) {
            console.log(`Không tìm thấy player ${record.player_id} (404)`);
          } else {
            console.error(`Lỗi khi kiểm tra player ${record.player_id}:`, error.response ? error.response.data : error);
          }
        }
      }
      page++;
    }
  } while (records.length === pageSize);

  console.log('✅ Quá trình sync hoàn tất.');
  console.log(`Tổng số user đổi tên: ${totalUsersChanged}`);
  console.log(`Tổng số tên cũ đã được thêm: ${totalOldNamesAdded}`);
}

// ------------------------
// Hàm main: Chạy sync và sau đó đóng kết nối MongoDB
// ------------------------
async function main() {
  await syncPlayerNamesPaginated();
  mongoose.connection.close(() => {
    console.log('Đã đóng kết nối MongoDB.');
    process.exit(0);
  });
}

main();
