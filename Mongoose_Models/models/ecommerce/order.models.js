import mongoose from "mongoose"

// A sub-schema: NOT registered as a model, only used inside another schema.
// It has no collection of its own — it's embedded in each order document.
const orderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
  },
  quantity: {
    type: Number,
    required: true,
  },
})

const orderSchema = new mongoose.Schema(
  {
    orderPrice: { type: Number, required: true },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    orderItems: [orderItemSchema], // array of embedded documents
    address: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "CANCELLED", "DELIVERED"], // only these three values allowed
      default: "PENDING",
    },
  },
  { timestamps: true }
)

export const Order = mongoose.model("Order", orderSchema)
