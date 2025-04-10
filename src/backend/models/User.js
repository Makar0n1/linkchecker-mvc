const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isSuperAdmin: { type: Boolean, default: false },
  plan: { type: String, default: 'free' }, // free, basic, pro, premium, enterprise
  subscriptionStatus: { type: String, default: 'inactive' }, // inactive, active, expired
  subscriptionEnd: { type: Date }, // Дата окончания подписки
  linksCheckedThisMonth: { type: Number, default: 0 }, // Счётчик ссылок за месяц
  lastReset: { type: Date, default: Date.now }, // Дата последнего сброса счётчика
  profile: {
    firstName: { type: String },
    lastName: { type: String },
    email: { type: String },
    phone: { type: String }
  },
  paymentDetails: {
    cardNumber: { type: String },
    cardHolder: { type: String },
    expiryDate: { type: String },
    cvv: { type: String }
  },
  autoPay: { type: Boolean, default: false } // Включена ли автооплата
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model('User', userSchema);