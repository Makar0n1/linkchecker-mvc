const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isSuperAdmin: { type: Boolean, default: false },
  plan: { type: String, default: 'free' },
  subscriptionStatus: { type: String, default: 'inactive' },
  subscriptionEnd: Date,
  paymentDetails: {
    cardNumber: String,
    cardHolder: String,
    expiryDate: String,
    cvv: String
  },
  autoPay: { type: Boolean, default: false },
  profile: {
    firstName: String,
    lastName: String,
    email: String,
    phone: String
  },
  linksCheckedThisMonth: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now }
});

userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    console.log('Hashing password for user:', this.username); // Добавляем отладочный лог
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

module.exports = mongoose.model('User', userSchema);