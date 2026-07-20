import mongoose from "mongoose"

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    salary: { type: Number, required: true },
    qualification: { type: String, required: true },
    experienceInYears: { type: Number, default: 0 },

    // A doctor can work in many hospitals, with different hours in each.
    // So the array holds OBJECTS, not just references.
    worksInHospitals: [
      {
        hospital: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Hospital",
        },
        hoursPerWeek: { type: Number },
      },
    ],
  },
  { timestamps: true }
)

export const Doctor = mongoose.model("Doctor", doctorSchema)
