#pragma once

#include <Arduino.h>

template <size_t Capacity>
class ByteRingBuffer {
 public:
  static_assert(Capacity > 0, "Ring buffer capacity must be positive");

  bool push(uint8_t value) {
    if (size_ == Capacity) {
      return false;
    }

    data_[head_] = value;
    head_ = (head_ + 1U) % Capacity;
    ++size_;
    return true;
  }

  size_t peek(uint8_t* destination, size_t requested) const {
    const size_t count = requested < size_ ? requested : size_;
    size_t position = tail_;

    for (size_t index = 0; index < count; ++index) {
      destination[index] = data_[position];
      position = (position + 1U) % Capacity;
    }

    return count;
  }

  void discard(size_t requested) {
    const size_t count = requested < size_ ? requested : size_;
    tail_ = (tail_ + count) % Capacity;
    size_ -= count;
  }

  void clear() {
    head_ = 0;
    tail_ = 0;
    size_ = 0;
  }

  size_t size() const { return size_; }
  constexpr size_t capacity() const { return Capacity; }

 private:
  uint8_t data_[Capacity] = {};
  size_t head_ = 0;
  size_t tail_ = 0;
  size_t size_ = 0;
};

