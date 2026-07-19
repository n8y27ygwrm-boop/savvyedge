"use client";

import Link from "next/link";
import { useState } from "react";

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Back Link */}
      <div>
        <Link
          href="/"
          className="text-xs font-semibold text-[#0ea5e9] hover:underline flex items-center gap-1"
        >
          ← Back to home
        </Link>
      </div>

      {/* Header */}
      <div className="border-b border-slate-800/80 pb-6 space-y-3">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Contact SavvyEdge
        </h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          Questions, partnerships, or data accuracy reports? Send a message to our intelligence team.
        </p>
      </div>

      {/* Form Container */}
      <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 sm:p-8 space-y-6">
        {submitted ? (
          <div className="bg-[#10b981]/10 border border-[#10b981]/30 rounded-xl p-6 text-center space-y-2">
            <span className="text-2xl">✅</span>
            <h3 className="text-lg font-bold text-white">Message Sent</h3>
            <p className="text-xs text-slate-300">
              Thank you for contacting SavvyEdge. We will review your message and respond within 48 hours.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Your Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="John Doe"
                  className="w-full bg-[#0b0f19] text-sm text-[#f3f4f6] placeholder-slate-500 px-3.5 py-2 rounded-xl border border-slate-700/80 focus:outline-none focus:border-[#0ea5e9]"
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="john@example.com"
                  className="w-full bg-[#0b0f19] text-sm text-[#f3f4f6] placeholder-slate-500 px-3.5 py-2 rounded-xl border border-slate-700/80 focus:outline-none focus:border-[#0ea5e9]"
                />
              </div>
            </div>

            {/* Subject Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 block">
                Subject Category
              </label>
              <select
                required
                className="w-full bg-[#0b0f19] text-sm text-[#f3f4f6] px-3.5 py-2 rounded-xl border border-slate-700/80 focus:outline-none focus:border-[#0ea5e9]"
              >
                <option value="general">General Inquiry</option>
                <option value="data-accuracy">Data Accuracy Report</option>
                <option value="partnership">Partnership</option>
                <option value="press">Press &amp; Media</option>
              </select>
            </div>

            {/* Message */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 block">
                Message
              </label>
              <textarea
                required
                rows={5}
                placeholder="Write your message here..."
                className="w-full bg-[#0b0f19] text-sm text-[#f3f4f6] placeholder-slate-500 px-3.5 py-2 rounded-xl border border-slate-700/80 focus:outline-none focus:border-[#0ea5e9]"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full sm:w-auto bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs transition-all shadow-md shadow-[#0ea5e9]/10"
            >
              Send Message
            </button>
          </form>
        )}

        {/* Dispute Note */}
        <div className="border-t border-slate-800/80 pt-4 text-xs text-slate-400 leading-relaxed">
          <span className="font-semibold text-slate-300">Data Dispute Resolution:</span>{" "}
          For data accuracy disputes, please include the casino name and the specific data point you believe is incorrect. We investigate all reports within 48 hours.
        </div>
      </div>
    </div>
  );
}
