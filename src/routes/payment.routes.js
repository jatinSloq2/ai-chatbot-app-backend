const express = require("express");
const router = express.Router();

const paymentController = require("../controllers/payment.controller");
const { protect } = require("../middlewares/auth.middleware");

router.use(protect);

router.post("/create-order", paymentController.createOrder);
router.post("/verify", paymentController.verifyPayment);
router.post("/cancel", paymentController.cancelSubscription);
router.get("/my-subscription", paymentController.mySubscription);

module.exports = router;
